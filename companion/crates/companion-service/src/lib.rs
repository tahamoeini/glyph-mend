//! Bounded local job manager. It owns no PDF parser and accepts bytes only.
#![forbid(unsafe_code)]

use bytes::Bytes;
use companion_contract::{
    Capability, ContractError, ErrorCode, InputChunk, JobCreate, Progress, MAX_CONCURRENT_JOBS,
    MAX_DOCUMENT_BYTES, MAX_EVENT_QUEUE,
};
use companion_core::{CapabilityProvider, DiagnosticMockProvider, JobState, ProviderInput};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{broadcast, Mutex, Semaphore};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobEvent {
    Progress(Progress),
    PageStarted { page: u32 },
    PageCompleted { page: u32 },
    Cancelled,
    Completed,
    Failed { code: ErrorCode },
}

struct JobRecord {
    state: JobState,
    request: JobCreate,
    next_chunk: u64,
    bytes: u64,
    digest: Sha256,
    cancellation: CancellationToken,
    events: broadcast::Sender<JobEvent>,
}

pub struct JobManager {
    jobs: Mutex<HashMap<Uuid, JobRecord>>,
    provider: Arc<dyn CapabilityProvider>,
    permits: Arc<Semaphore>,
}

impl Default for JobManager {
    fn default() -> Self {
        Self::new(Arc::new(DiagnosticMockProvider))
    }
}

impl JobManager {
    pub fn new(provider: Arc<dyn CapabilityProvider>) -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            provider,
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT_JOBS)),
        }
    }

    pub fn capabilities(&self) -> Vec<Capability> {
        vec![self.provider.capability()]
    }

    pub async fn create(&self, request: JobCreate) -> Result<Uuid, ContractError> {
        request.validate()?;
        if request
            .requested_capabilities
            .iter()
            .any(|id| id != &self.provider.capability().id)
        {
            return Err(ContractError::Code(ErrorCode::IrSchemaUnsupported));
        }
        let job_id = Uuid::new_v4();
        let (events, _) = broadcast::channel(MAX_EVENT_QUEUE);
        self.jobs.lock().await.insert(
            job_id,
            JobRecord {
                state: JobState::Created
                    .transition(JobState::Receiving)
                    .expect("valid transition"),
                request,
                next_chunk: 0,
                bytes: 0,
                digest: Sha256::new(),
                cancellation: CancellationToken::new(),
                events,
            },
        );
        Ok(job_id)
    }

    pub async fn subscribe(
        &self,
        job_id: Uuid,
    ) -> Result<broadcast::Receiver<JobEvent>, ContractError> {
        self.jobs
            .lock()
            .await
            .get(&job_id)
            .map(|job| job.events.subscribe())
            .ok_or(ContractError::Code(ErrorCode::NotFound))
    }

    pub async fn append_chunk(
        &self,
        job_id: Uuid,
        metadata: InputChunk,
        body: Bytes,
    ) -> Result<(), ContractError> {
        metadata.validate()?;
        if body.len() != metadata.declared_length as usize {
            return Err(ContractError::Code(ErrorCode::InvalidEnvelope));
        }
        let mut jobs = self.jobs.lock().await;
        let job = jobs
            .get_mut(&job_id)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        if job.state != JobState::Receiving {
            return Err(ContractError::Code(ErrorCode::InvalidState));
        }
        if metadata.chunk_sequence != job.next_chunk {
            return Err(ContractError::Code(ErrorCode::InvalidSequence));
        }
        let next_bytes = job.bytes.saturating_add(body.len() as u64);
        if next_bytes > job.request.declared_bytes || next_bytes > MAX_DOCUMENT_BYTES {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        job.digest.update(&body);
        job.bytes = next_bytes;
        job.next_chunk += 1;
        Ok(())
    }

    pub async fn complete_input(
        &self,
        job_id: Uuid,
        expected_sha256_hex: &str,
    ) -> Result<(), ContractError> {
        let (request, bytes, cancellation, events) = {
            let mut jobs = self.jobs.lock().await;
            let job = jobs
                .get_mut(&job_id)
                .ok_or(ContractError::Code(ErrorCode::NotFound))?;
            if job.state != JobState::Receiving {
                return Err(ContractError::Code(ErrorCode::InvalidState));
            }
            if job.bytes != job.request.declared_bytes {
                return Err(ContractError::Code(ErrorCode::DigestMismatch));
            }
            if hex::encode(job.digest.clone().finalize())
                != expected_sha256_hex.to_ascii_lowercase()
            {
                return Err(ContractError::Code(ErrorCode::DigestMismatch));
            }
            job.state = job
                .state
                .transition(JobState::Queued)
                .map_err(|_| ContractError::Code(ErrorCode::InvalidState))?;
            (
                job.request.clone(),
                job.bytes,
                job.cancellation.clone(),
                job.events.clone(),
            )
        };
        let provider = Arc::clone(&self.provider);
        let permits = Arc::clone(&self.permits);
        let jobs = &self.jobs;
        // The actual execution is deliberately initiated by `run_queued` so bridge and Tauri share one lifecycle.
        let _ = (
            request,
            bytes,
            cancellation,
            events,
            provider,
            permits,
            jobs,
        );
        Ok(())
    }

    pub async fn run_queued(&self, job_id: Uuid) -> Result<(), ContractError> {
        let permit = self
            .permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| ContractError::Code(ErrorCode::Internal))?;
        let (request, bytes, cancellation, events) = {
            let mut jobs = self.jobs.lock().await;
            let job = jobs
                .get_mut(&job_id)
                .ok_or(ContractError::Code(ErrorCode::NotFound))?;
            job.state = job
                .state
                .transition(JobState::Running)
                .map_err(|_| ContractError::Code(ErrorCode::InvalidState))?;
            (
                job.request.clone(),
                job.bytes,
                job.cancellation.clone(),
                job.events.clone(),
            )
        };
        let output = self.provider.run(
            ProviderInput {
                job_id,
                page_count: request.page_count,
                bytes_received: bytes,
            },
            cancellation.clone(),
        );
        let mut jobs = self.jobs.lock().await;
        let job = jobs
            .get_mut(&job_id)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        if cancellation.is_cancelled() {
            job.state = JobState::Cancelling
                .transition(JobState::Cancelled)
                .unwrap_or(JobState::Cancelled);
            let _ = events.send(JobEvent::Cancelled);
        } else if let Ok(output) = output {
            for progress in output.progress {
                let page = progress.completed_pages;
                let _ = events.send(JobEvent::PageStarted { page });
                let _ = events.send(JobEvent::Progress(progress));
                let _ = events.send(JobEvent::PageCompleted { page });
            }
            job.state = job
                .state
                .transition(JobState::Completed)
                .map_err(|_| ContractError::Code(ErrorCode::InvalidState))?;
            let _ = events.send(JobEvent::Completed);
        } else {
            job.state = JobState::Failed;
            let _ = events.send(JobEvent::Failed {
                code: ErrorCode::Internal,
            });
        }
        drop(permit);
        Ok(())
    }

    pub async fn cancel(&self, job_id: Uuid) -> Result<(), ContractError> {
        let mut jobs = self.jobs.lock().await;
        let job = jobs
            .get_mut(&job_id)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        match job.state {
            JobState::Completed | JobState::Cancelled | JobState::Failed => return Ok(()),
            JobState::Created | JobState::Receiving | JobState::Queued => {
                job.cancellation.cancel();
                job.state = JobState::Cancelled;
                let _ = job.events.send(JobEvent::Cancelled);
            }
            JobState::Running => {
                job.state = JobState::Cancelling;
                job.cancellation.cancel();
            }
            JobState::Cancelling => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn validates_chunks_and_emits_ordered_mock_events() {
        let manager = JobManager::default();
        let job = manager
            .create(JobCreate {
                document_name: "fixture.pdf".into(),
                declared_bytes: 3,
                page_count: 2,
                requested_capabilities: vec!["glyphmend.diagnostic.mock.v1".into()],
                idempotency_key: Uuid::new_v4(),
            })
            .await
            .unwrap();
        let mut events = manager.subscribe(job).await.unwrap();
        manager
            .append_chunk(
                job,
                InputChunk {
                    chunk_sequence: 0,
                    declared_length: 3,
                },
                Bytes::from_static(b"pdf"),
            )
            .await
            .unwrap();
        let digest = hex::encode(Sha256::digest(b"pdf"));
        manager.complete_input(job, &digest).await.unwrap();
        manager.run_queued(job).await.unwrap();
        assert_eq!(
            events.recv().await.unwrap(),
            JobEvent::PageStarted { page: 1 }
        );
        assert!(matches!(
            events.recv().await.unwrap(),
            JobEvent::Progress(_)
        ));
    }
    #[tokio::test]
    async fn rejects_reordered_chunks_and_idempotently_cancels() {
        let manager = JobManager::default();
        let job = manager
            .create(JobCreate {
                document_name: "fixture.pdf".into(),
                declared_bytes: 1,
                page_count: 1,
                requested_capabilities: vec!["glyphmend.diagnostic.mock.v1".into()],
                idempotency_key: Uuid::new_v4(),
            })
            .await
            .unwrap();
        assert_eq!(
            manager
                .append_chunk(
                    job,
                    InputChunk {
                        chunk_sequence: 1,
                        declared_length: 1
                    },
                    Bytes::from_static(b"x")
                )
                .await,
            Err(ContractError::Code(ErrorCode::InvalidSequence))
        );
        manager.cancel(job).await.unwrap();
        manager.cancel(job).await.unwrap();
    }
}
