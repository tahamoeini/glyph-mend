//! Bounded local job manager with persisted input and replayable events.
#![forbid(unsafe_code)]

use bytes::Bytes;
use companion_contract::{
    Capability, ContractError, ErrorCode, InputChunk, InputComplete, JobCreate, ProviderResult,
    JOB_RETENTION_SECS, MAX_CONCURRENT_JOBS, MAX_DOCUMENT_BYTES, MAX_EVENT_QUEUE,
};
use companion_core::{
    CapabilityProvider, CoreError, DiagnosticMockProvider, JobState, ProviderInput,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Notify, Semaphore};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobEvent {
    Queued,
    Progress(companion_contract::Progress),
    PageStarted { page: u32 },
    PageCompleted { page: u32 },
    Cancelled,
    Completed,
    Failed { code: ErrorCode },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequencedJobEvent {
    pub schema: &'static str,
    pub sequence: u64,
    pub job_id: Uuid,
    pub event_type: &'static str,
    pub payload: JobEvent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsPage {
    pub events: Vec<SequencedJobEvent>,
    pub next_sequence: u64,
    pub terminal: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResultResponse {
    pub job_id: Uuid,
    pub status: JobState,
    pub terminal: bool,
    pub result: Option<ProviderResult>,
}

struct JobRecord {
    state: JobState,
    request: JobCreate,
    next_chunk: u64,
    bytes: u64,
    digest: Sha256,
    chunk_hashes: HashMap<u64, Vec<u8>>,
    input_path: PathBuf,
    content_hash: Option<String>,
    cancellation: CancellationToken,
    event_sequence: u64,
    events: Vec<SequencedJobEvent>,
    notify: Arc<Notify>,
    result: Option<ProviderResult>,
    last_touched: Instant,
}

pub struct JobManager {
    jobs: Mutex<HashMap<Uuid, JobRecord>>,
    idempotency: Mutex<HashMap<Uuid, Uuid>>,
    providers: Vec<Arc<dyn CapabilityProvider>>,
    permits: Arc<Semaphore>,
    storage_dir: PathBuf,
    retention: Duration,
}

impl Default for JobManager {
    fn default() -> Self {
        let storage_dir =
            std::env::temp_dir().join(format!("glyphmend-companion-{}", Uuid::new_v4()));
        Self::with_storage_dir(Arc::new(DiagnosticMockProvider), storage_dir)
            .expect("companion temporary storage must be creatable")
    }
}

impl JobManager {
    pub fn new(provider: Arc<dyn CapabilityProvider>) -> Self {
        let storage_dir =
            std::env::temp_dir().join(format!("glyphmend-companion-{}", Uuid::new_v4()));
        Self::with_storage_dir(provider, storage_dir)
            .expect("companion temporary storage must be creatable")
    }

    pub fn with_storage_dir(
        provider: Arc<dyn CapabilityProvider>,
        storage_dir: PathBuf,
    ) -> Result<Self, std::io::Error> {
        Self::with_providers_and_retention(
            vec![provider],
            storage_dir,
            Duration::from_secs(JOB_RETENTION_SECS),
        )
    }

    pub fn with_providers(
        providers: Vec<Arc<dyn CapabilityProvider>>,
        storage_dir: PathBuf,
    ) -> Result<Self, std::io::Error> {
        Self::with_providers_and_retention(
            providers,
            storage_dir,
            Duration::from_secs(JOB_RETENTION_SECS),
        )
    }

    pub fn with_providers_and_retention(
        providers: Vec<Arc<dyn CapabilityProvider>>,
        storage_dir: PathBuf,
        retention: Duration,
    ) -> Result<Self, std::io::Error> {
        if providers.is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "at least one provider is required",
            ));
        }
        fs::create_dir_all(&storage_dir)?;
        Ok(Self {
            jobs: Mutex::new(HashMap::new()),
            idempotency: Mutex::new(HashMap::new()),
            providers,
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT_JOBS)),
            storage_dir,
            retention,
        })
    }
    pub fn capabilities(&self) -> Vec<Capability> {
        self.providers
            .iter()
            .map(|provider| provider.capability())
            .collect()
    }

    pub async fn create(&self, request: JobCreate) -> Result<Uuid, ContractError> {
        request.validate()?;
        if !self
            .providers
            .iter()
            .any(|provider| provider.capability().id == request.capability_id)
        {
            return Err(ContractError::Code(ErrorCode::IrSchemaUnsupported));
        }
        self.cleanup_expired().await;
        if let Some(job_id) = self
            .idempotency
            .lock()
            .await
            .get(&request.idempotency_key)
            .copied()
        {
            return Ok(job_id);
        }

        let job_id = Uuid::new_v4();
        let input_path = self.storage_dir.join(format!("{job_id}.input"));
        fs::File::create(&input_path).map_err(|_| ContractError::Code(ErrorCode::Internal))?;
        let (notify, _) = (Arc::new(Notify::new()), ());
        let record = JobRecord {
            state: JobState::Created
                .transition(JobState::Receiving)
                .expect("valid transition"),
            request,
            next_chunk: 0,
            bytes: 0,
            digest: Sha256::new(),
            chunk_hashes: HashMap::new(),
            input_path,
            content_hash: None,
            cancellation: CancellationToken::new(),
            event_sequence: 0,
            events: Vec::new(),
            notify,
            result: None,
            last_touched: Instant::now(),
        };
        self.jobs.lock().await.insert(job_id, record);
        let request_key = self
            .jobs
            .lock()
            .await
            .get(&job_id)
            .map(|job| job.request.idempotency_key);
        if let Some(request_key) = request_key {
            self.idempotency.lock().await.insert(request_key, job_id);
        }
        Ok(job_id)
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
        let body_hash = Sha256::digest(&body).to_vec();
        let mut jobs = self.jobs.lock().await;
        let job = jobs
            .get_mut(&job_id)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        if job.state != JobState::Receiving {
            return Err(ContractError::Code(ErrorCode::InvalidState));
        }
        if metadata.chunk_sequence < job.next_chunk {
            return if job.chunk_hashes.get(&metadata.chunk_sequence) == Some(&body_hash) {
                job.last_touched = Instant::now();
                Ok(())
            } else {
                Err(ContractError::Code(ErrorCode::Conflict))
            };
        }
        if metadata.chunk_sequence != job.next_chunk {
            return Err(ContractError::Code(ErrorCode::InvalidSequence));
        }
        let next_bytes = job.bytes.saturating_add(body.len() as u64);
        if next_bytes > job.request.declared_bytes || next_bytes > MAX_DOCUMENT_BYTES {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        let mut file = OpenOptions::new()
            .append(true)
            .open(&job.input_path)
            .map_err(|_| ContractError::Code(ErrorCode::Internal))?;
        file.write_all(&body)
            .map_err(|_| ContractError::Code(ErrorCode::Internal))?;
        job.digest.update(&body);
        job.chunk_hashes.insert(metadata.chunk_sequence, body_hash);
        job.bytes = next_bytes;
        job.next_chunk += 1;
        job.last_touched = Instant::now();
        Ok(())
    }

    pub async fn complete_input(
        &self,
        job_id: Uuid,
        request: InputComplete,
    ) -> Result<(), ContractError> {
        request.validate()?;
        let mut jobs = self.jobs.lock().await;
        let job = jobs
            .get_mut(&job_id)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        if job.state != JobState::Receiving {
            return Err(ContractError::Code(ErrorCode::InvalidState));
        }
        if job.bytes != job.request.declared_bytes || job.bytes != request.total_bytes {
            return Err(ContractError::Code(ErrorCode::DigestMismatch));
        }
        let digest = hex::encode(job.digest.clone().finalize());
        if digest != request.sha256_hex.to_ascii_lowercase() {
            return Err(ContractError::Code(ErrorCode::DigestMismatch));
        }
        job.content_hash = Some(format!("sha256:{digest}"));
        job.state = job
            .state
            .transition(JobState::Queued)
            .map_err(|_| ContractError::Code(ErrorCode::InvalidState))?;
        append_event(job_id, job, JobEvent::Queued);
        Ok(())
    }

    pub async fn run_queued(&self, job_id: Uuid) -> Result<(), ContractError> {
        let permit = self
            .permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| ContractError::Code(ErrorCode::Internal))?;
        let (request, bytes, content_hash, input_path, cancellation, provider) = {
            let mut jobs = self.jobs.lock().await;
            let capability_id = jobs
                .get(&job_id)
                .map(|job| job.request.capability_id.clone())
                .ok_or(ContractError::Code(ErrorCode::NotFound))?;
            let provider = self
                .providers
                .iter()
                .find(|provider| provider.capability().id == capability_id)
                .cloned()
                .ok_or(ContractError::Code(ErrorCode::IrSchemaUnsupported))?;
            let job = jobs
                .get_mut(&job_id)
                .ok_or(ContractError::Code(ErrorCode::NotFound))?;
            job.state = job
                .state
                .transition(JobState::Running)
                .map_err(|_| ContractError::Code(ErrorCode::InvalidState))?;
            job.last_touched = Instant::now();
            (
                job.request.clone(),
                job.bytes,
                job.content_hash.clone().unwrap_or_default(),
                job.input_path.clone(),
                job.cancellation.clone(),
                provider,
            )
        };

        let output = provider.run(
            ProviderInput {
                job_id,
                input_kind: request.input_kind,
                capability_id: request.capability_id,
                page_count: request.page_count,
                bytes_received: bytes,
                content_hash,
                input_path,
                metadata: request.metadata,
            },
            cancellation.clone(),
        );
        let mut jobs = self.jobs.lock().await;
        let job = jobs
            .get_mut(&job_id)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        if cancellation.is_cancelled() {
            job.state = JobState::Cancelled;
            append_event(job_id, job, JobEvent::Cancelled);
        } else {
            match output {
                Ok(output) => {
                    for progress in output.progress {
                        let page = progress.completed_pages;
                        append_event(job_id, job, JobEvent::PageStarted { page });
                        append_event(job_id, job, JobEvent::Progress(progress));
                        append_event(job_id, job, JobEvent::PageCompleted { page });
                    }
                    job.result = output.result;
                    job.state = job
                        .state
                        .transition(JobState::Completed)
                        .map_err(|_| ContractError::Code(ErrorCode::InvalidState))?;
                    append_event(job_id, job, JobEvent::Completed);
                }
                Err(error) => {
                    let code = core_error_code(&error);
                    job.state = if code == ErrorCode::Cancelled {
                        JobState::Cancelled
                    } else {
                        JobState::Failed
                    };
                    append_event(
                        job_id,
                        job,
                        if code == ErrorCode::Cancelled {
                            JobEvent::Cancelled
                        } else {
                            JobEvent::Failed { code }
                        },
                    );
                }
            }
        }
        job.last_touched = Instant::now();
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
                append_event(job_id, job, JobEvent::Cancelled);
            }
            JobState::Running => {
                job.state = JobState::Cancelling;
                job.cancellation.cancel();
            }
            JobState::Cancelling => {}
        }
        job.last_touched = Instant::now();
        Ok(())
    }

    pub async fn events_after(
        &self,
        job_id: Uuid,
        after: u64,
        limit: usize,
        wait: Duration,
    ) -> Result<EventsPage, ContractError> {
        let limit = limit.clamp(1, MAX_EVENT_QUEUE);
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            let notified = {
                let jobs = self.jobs.lock().await;
                let job = jobs
                    .get(&job_id)
                    .ok_or(ContractError::Code(ErrorCode::NotFound))?;
                let events = job
                    .events
                    .iter()
                    .filter(|event| event.sequence > after)
                    .take(limit)
                    .cloned()
                    .collect::<Vec<_>>();
                let terminal = is_terminal(job.state);
                if !events.is_empty() || terminal || wait.is_zero() {
                    let next_sequence = events.last().map(|event| event.sequence).unwrap_or(after);
                    return Ok(EventsPage {
                        events,
                        next_sequence,
                        terminal,
                    });
                }
                Arc::clone(&job.notify)
            };
            tokio::select! {
                _ = notified.notified() => {}
                _ = tokio::time::sleep_until(deadline) => {
                    let jobs = self.jobs.lock().await;
                    let job = jobs.get(&job_id).ok_or(ContractError::Code(ErrorCode::NotFound))?;
                    return Ok(EventsPage {
                        events: Vec::new(),
                        next_sequence: after,
                        terminal: is_terminal(job.state),
                    });
                }
            }
        }
    }

    pub async fn result(&self, job_id: Uuid) -> Result<JobResultResponse, ContractError> {
        let jobs = self.jobs.lock().await;
        let job = jobs
            .get(&job_id)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        Ok(JobResultResponse {
            job_id,
            status: job.state,
            terminal: is_terminal(job.state),
            result: job.result.clone(),
        })
    }

    pub async fn cleanup_expired(&self) {
        let expired = {
            let mut jobs = self.jobs.lock().await;
            let now = Instant::now();
            let ids = jobs
                .iter()
                .filter_map(|(id, job)| {
                    (is_terminal(job.state)
                        && now.duration_since(job.last_touched) >= self.retention)
                        .then_some(*id)
                })
                .collect::<Vec<_>>();
            ids.iter()
                .filter_map(|id| jobs.remove(id).map(|job| (*id, job.input_path)))
                .collect::<Vec<_>>()
        };
        if !expired.is_empty() {
            let mut idempotency = self.idempotency.lock().await;
            for (id, path) in expired {
                idempotency.retain(|_, job_id| *job_id != id);
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn append_event(job_id: Uuid, job: &mut JobRecord, payload: JobEvent) {
    job.event_sequence += 1;
    let event_type = match &payload {
        JobEvent::Queued => "job-queued",
        JobEvent::Progress(_) => "job-progress",
        JobEvent::PageStarted { .. } => "page-started",
        JobEvent::PageCompleted { .. } => "page-completed",
        JobEvent::Cancelled => "job-cancelled",
        JobEvent::Completed => "job-completed",
        JobEvent::Failed { .. } => "job-failed",
    };
    job.events.push(SequencedJobEvent {
        schema: "glyphmend.companion-event.v1",
        sequence: job.event_sequence,
        job_id,
        event_type,
        payload,
    });
    if job.events.len() > MAX_EVENT_QUEUE {
        let overflow = job.events.len() - MAX_EVENT_QUEUE;
        job.events.drain(0..overflow);
    }
    job.notify.notify_waiters();
}

fn is_terminal(state: JobState) -> bool {
    matches!(
        state,
        JobState::Completed | JobState::Cancelled | JobState::Failed
    )
}

fn core_error_code(error: &CoreError) -> ErrorCode {
    match error {
        CoreError::Contract(ContractError::Code(code)) => *code,
        CoreError::Contract(ContractError::IncompatibleProtocol { .. }) => {
            ErrorCode::ProtocolIncompatible
        }
        CoreError::Contract(ContractError::Limit(_)) => ErrorCode::PayloadTooLarge,
        CoreError::InvalidTransition { .. } | CoreError::Provider(_) => ErrorCode::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(bytes: u64) -> JobCreate {
        JobCreate {
            document_name: "fixture.pdf".into(),
            capability_id: "glyphmend.diagnostic.mock.v1".into(),
            input_kind: companion_contract::InputKind::Document,
            declared_bytes: bytes,
            page_count: 2,
            metadata: serde_json::json!({}),
            idempotency_key: Uuid::new_v4(),
        }
    }

    #[tokio::test]
    async fn persists_chunks_accepts_identical_retry_and_emits_ordered_events() {
        let directory =
            std::env::temp_dir().join(format!("glyphmend-service-test-{}", Uuid::new_v4()));
        let manager =
            JobManager::with_storage_dir(Arc::new(DiagnosticMockProvider), directory.clone())
                .unwrap();
        let job = manager.create(request(3)).await.unwrap();
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
        manager
            .complete_input(
                job,
                InputComplete {
                    sha256_hex: digest,
                    total_bytes: 3,
                },
            )
            .await
            .unwrap();
        manager.run_queued(job).await.unwrap();
        let page = manager
            .events_after(job, 0, 64, Duration::ZERO)
            .await
            .unwrap();
        assert!(page
            .events
            .windows(2)
            .all(|events| events[0].sequence < events[1].sequence));
        assert!(page.terminal);
        assert!(manager.result(job).await.unwrap().result.is_some());
    }

    #[tokio::test]
    async fn rejects_reordered_and_conflicting_chunks() {
        let directory =
            std::env::temp_dir().join(format!("glyphmend-service-test-{}", Uuid::new_v4()));
        let manager =
            JobManager::with_storage_dir(Arc::new(DiagnosticMockProvider), directory.clone())
                .unwrap();
        let job = manager.create(request(1)).await.unwrap();
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
        manager
            .append_chunk(
                job,
                InputChunk {
                    chunk_sequence: 0,
                    declared_length: 1,
                },
                Bytes::from_static(b"x"),
            )
            .await
            .unwrap();
        assert_eq!(
            manager
                .append_chunk(
                    job,
                    InputChunk {
                        chunk_sequence: 0,
                        declared_length: 1
                    },
                    Bytes::from_static(b"y")
                )
                .await,
            Err(ContractError::Code(ErrorCode::Conflict))
        );
        manager.cancel(job).await.unwrap();
        manager.cancel(job).await.unwrap();
    }

    #[tokio::test]
    async fn cleanup_removes_terminal_jobs_after_configured_ttl() {
        let directory =
            std::env::temp_dir().join(format!("glyphmend-service-test-{}", Uuid::new_v4()));
        let manager = JobManager::with_providers_and_retention(
            vec![Arc::new(DiagnosticMockProvider)],
            directory.clone(),
            Duration::ZERO,
        )
        .unwrap();
        let job = manager.create(request(0)).await.unwrap();
        manager.cancel(job).await.unwrap();
        manager.cleanup_expired().await;
        assert!(matches!(
            manager.result(job).await,
            Err(ContractError::Code(ErrorCode::NotFound))
        ));
        assert!(!directory.join(format!("{job}.input")).exists());
        let _ = fs::remove_dir_all(directory);
    }
}
