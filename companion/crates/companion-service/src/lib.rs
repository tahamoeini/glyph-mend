//! Bounded local job manager with persisted input and replayable events.
#![forbid(unsafe_code)]

use bytes::Bytes;
use companion_contract::{
    Capability, ContractError, ErrorCode, InputChunk, InputComplete, JobCreate, ProviderResult,
    ABANDONED_JOB_TTL_SECS, JOB_RETENTION_SECS, MAX_ACTIVE_JOBS, MAX_CONCURRENT_JOBS,
    MAX_CONTROL_BYTES, MAX_DOCUMENT_BYTES, MAX_EVENT_QUEUE, MAX_RUNTIME_BYTES, MAX_SESSION_BYTES,
    PROVIDER_TIMEOUT_SECS,
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
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime},
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
    pub earliest_sequence: u64,
    pub history_truncated: bool,
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
    owner_session: Uuid,
    request: JobCreate,
    completed_input: Option<InputComplete>,
    worker_running: bool,
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

#[derive(Clone)]
struct IdempotencyRecord {
    job_id: Uuid,
    request_hash: Vec<u8>,
}

pub struct JobManager {
    jobs: Arc<Mutex<HashMap<Uuid, JobRecord>>>,
    idempotency: Mutex<HashMap<(Uuid, Uuid), IdempotencyRecord>>,
    providers: Vec<Arc<dyn CapabilityProvider>>,
    permits: Arc<Semaphore>,
    storage_dir: PathBuf,
    storage_bytes: Arc<Mutex<u64>>,
    retention: Duration,
    abandoned_ttl: Duration,
    provider_timeout: Duration,
}

impl Drop for JobManager {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.storage_dir);
    }
}

impl Default for JobManager {
    fn default() -> Self {
        Self::with_storage_dir(Arc::new(DiagnosticMockProvider), default_storage_dir())
            .expect("companion temporary storage must be creatable")
    }
}

impl JobManager {
    pub fn new(provider: Arc<dyn CapabilityProvider>) -> Self {
        Self::with_storage_dir(provider, default_storage_dir())
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
        create_private_dir(&storage_dir)?;
        Ok(Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            idempotency: Mutex::new(HashMap::new()),
            providers,
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT_JOBS)),
            storage_dir,
            storage_bytes: Arc::new(Mutex::new(0)),
            retention,
            abandoned_ttl: Duration::from_secs(ABANDONED_JOB_TTL_SECS),
            provider_timeout: Duration::from_secs(PROVIDER_TIMEOUT_SECS),
        })
    }

    pub fn with_abandoned_ttl(mut self, ttl: Duration) -> Self {
        self.abandoned_ttl = ttl;
        self
    }

    pub fn with_provider_timeout(mut self, timeout: Duration) -> Self {
        self.provider_timeout = timeout;
        self
    }

    pub fn capabilities(&self) -> Result<Vec<Capability>, ContractError> {
        let capabilities = self
            .providers
            .iter()
            .map(|provider| {
                let capability = provider.capability();
                capability.validate()?;
                Ok(capability)
            })
            .collect::<Result<Vec<_>, ContractError>>()?;
        if serde_json::to_vec(&capabilities).map_or(true, |bytes| bytes.len() > MAX_CONTROL_BYTES) {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        Ok(capabilities)
    }

    pub async fn create(
        &self,
        owner_session: Uuid,
        request: JobCreate,
    ) -> Result<Uuid, ContractError> {
        request.validate()?;
        if !self
            .providers
            .iter()
            .any(|provider| provider.capability().id == request.capability_id)
        {
            return Err(ContractError::Code(ErrorCode::CapabilityUnsupported));
        }
        self.cleanup_expired().await;
        let request_bytes = serde_json::to_vec(&request)
            .map_err(|_| ContractError::Code(ErrorCode::InvalidRequest))?;
        let request_hash = Sha256::digest(request_bytes).to_vec();
        let idempotency_key = (owner_session, request.idempotency_key);
        let mut idempotency = self.idempotency.lock().await;
        if let Some(existing) = idempotency.get(&idempotency_key) {
            return if existing.request_hash == request_hash {
                Ok(existing.job_id)
            } else {
                Err(ContractError::Code(ErrorCode::Conflict))
            };
        }

        let mut jobs = self.jobs.lock().await;
        let active_jobs = jobs.values().filter(|job| !is_terminal(job.state)).count();
        if active_jobs >= MAX_ACTIVE_JOBS {
            return Err(ContractError::Code(ErrorCode::Busy));
        }
        let job_id = Uuid::new_v4();
        let input_path = self.storage_dir.join(format!("{job_id}.input"));
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&input_path)
            .map_err(|_| ContractError::Code(ErrorCode::Internal))?;
        let record = JobRecord {
            state: JobState::Created
                .transition(JobState::Receiving)
                .expect("valid transition"),
            owner_session,
            request,
            completed_input: None,
            worker_running: false,
            next_chunk: 0,
            bytes: 0,
            digest: Sha256::new(),
            chunk_hashes: HashMap::new(),
            input_path,
            content_hash: None,
            cancellation: CancellationToken::new(),
            event_sequence: 0,
            events: Vec::new(),
            notify: Arc::new(Notify::new()),
            result: None,
            last_touched: Instant::now(),
        };
        jobs.insert(job_id, record);
        idempotency.insert(
            idempotency_key,
            IdempotencyRecord {
                job_id,
                request_hash,
            },
        );
        Ok(job_id)
    }

    pub async fn append_chunk(
        &self,
        owner_session: Uuid,
        job_id: Uuid,
        metadata: InputChunk,
        body: Bytes,
    ) -> Result<(), ContractError> {
        self.cleanup_expired().await;
        metadata.validate()?;
        if body.len() > companion_contract::MAX_CHUNK_BYTES
            || body.len() != metadata.declared_length as usize
        {
            return Err(ContractError::Code(ErrorCode::InvalidRequest));
        }
        let body_hash = Sha256::digest(&body).to_vec();
        let mut jobs = self.jobs.lock().await;
        let session_bytes = jobs
            .values()
            .filter(|stored_job| stored_job.owner_session == owner_session)
            .map(|stored_job| stored_job.bytes)
            .sum::<u64>();
        let job = jobs
            .get_mut(&job_id)
            .filter(|job| job.owner_session == owner_session)
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
        let chunk_bytes = body.len() as u64;
        let next_bytes = job.bytes.saturating_add(chunk_bytes);
        if next_bytes > job.request.declared_bytes || next_bytes > MAX_DOCUMENT_BYTES {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        let mut stored_bytes = self.storage_bytes.lock().await;
        if !storage_quota_allows(*stored_bytes, session_bytes, chunk_bytes) {
            return Err(ContractError::Code(ErrorCode::Busy));
        }
        let job = jobs
            .get_mut(&job_id)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
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
        *stored_bytes += chunk_bytes;
        Ok(())
    }

    pub async fn complete_input(
        &self,
        owner_session: Uuid,
        job_id: Uuid,
        request: InputComplete,
    ) -> Result<bool, ContractError> {
        self.cleanup_expired().await;
        request.validate()?;
        let mut jobs = self.jobs.lock().await;
        let job = jobs
            .get_mut(&job_id)
            .filter(|job| job.owner_session == owner_session)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        let normalized = InputComplete {
            sha256_hex: request.sha256_hex.to_ascii_lowercase(),
            total_bytes: request.total_bytes,
        };
        if let Some(completed) = &job.completed_input {
            return if completed == &normalized {
                Ok(false)
            } else {
                Err(ContractError::Code(ErrorCode::Conflict))
            };
        }
        if job.state != JobState::Receiving {
            return Err(ContractError::Code(ErrorCode::InvalidState));
        }
        if job.bytes != job.request.declared_bytes || job.bytes != request.total_bytes {
            return Err(ContractError::Code(ErrorCode::DigestMismatch));
        }
        let digest = hex::encode(job.digest.clone().finalize());
        if digest != normalized.sha256_hex {
            return Err(ContractError::Code(ErrorCode::DigestMismatch));
        }
        job.content_hash = Some(digest);
        job.completed_input = Some(normalized);
        job.state = job
            .state
            .transition(JobState::Queued)
            .map_err(|_| ContractError::Code(ErrorCode::InvalidState))?;
        append_event(job_id, job, JobEvent::Queued);
        Ok(true)
    }

    pub async fn run_queued(&self, job_id: Uuid) -> Result<(), ContractError> {
        self.cleanup_expired().await;
        let cancellation = {
            let jobs = self.jobs.lock().await;
            let job = jobs
                .get(&job_id)
                .ok_or(ContractError::Code(ErrorCode::NotFound))?;
            if job.state != JobState::Queued {
                return Err(ContractError::Code(ErrorCode::InvalidState));
            }
            job.cancellation.clone()
        };
        let permit = tokio::select! {
            acquired = self.permits.clone().acquire_owned() => {
                acquired.map_err(|_| ContractError::Code(ErrorCode::Internal))?
            }
            _ = cancellation.cancelled() => return Ok(()),
        };
        let (input, provider) = {
            let mut jobs = self.jobs.lock().await;
            let job = jobs
                .get_mut(&job_id)
                .ok_or(ContractError::Code(ErrorCode::NotFound))?;
            if job.state != JobState::Queued || cancellation.is_cancelled() {
                return Ok(());
            }
            let provider = self
                .providers
                .iter()
                .find(|provider| provider.capability().id == job.request.capability_id)
                .cloned()
                .ok_or(ContractError::Code(ErrorCode::CapabilityUnsupported))?;
            job.state = job
                .state
                .transition(JobState::Running)
                .map_err(|_| ContractError::Code(ErrorCode::InvalidState))?;
            job.worker_running = true;
            job.last_touched = Instant::now();
            (
                ProviderInput {
                    job_id,
                    input_kind: job.request.input_kind,
                    capability_id: job.request.capability_id.clone(),
                    page_count: job.request.page_count,
                    bytes_received: job.bytes,
                    content_hash: job.content_hash.clone().unwrap_or_default(),
                    input_path: job.input_path.clone(),
                    metadata: job.request.metadata.clone(),
                },
                provider,
            )
        };
        let worker_cancellation = cancellation.clone();
        let mut worker =
            tokio::task::spawn_blocking(move || provider.run(input, worker_cancellation));
        let completed = tokio::time::timeout(self.provider_timeout, &mut worker).await;
        let joined = match completed {
            Ok(result) => result,
            Err(_) => {
                let cancelled_by_user = cancellation.is_cancelled();
                cancellation.cancel();
                let code = if cancelled_by_user {
                    ErrorCode::Cancelled
                } else {
                    ErrorCode::TimedOut
                };
                {
                    let mut jobs = self.jobs.lock().await;
                    if let Some(job) = jobs.get_mut(&job_id) {
                        job.state = if code == ErrorCode::Cancelled {
                            JobState::Cancelled
                        } else {
                            JobState::Failed
                        };
                        job.last_touched = Instant::now();
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
                let jobs = Arc::clone(&self.jobs);
                let storage_bytes = Arc::clone(&self.storage_bytes);
                tokio::spawn(async move {
                    let _ = worker.await;
                    let mut jobs = jobs.lock().await;
                    if let Some(job) = jobs.get_mut(&job_id) {
                        let released = remove_job_input(job);
                        if released > 0 {
                            let mut stored = storage_bytes.lock().await;
                            *stored = stored.saturating_sub(released);
                        }
                        job.worker_running = false;
                    }
                    drop(permit);
                });
                return Ok(());
            }
        };
        drop(permit);
        let output = match joined {
            Ok(Ok(output)) => {
                let result_error =
                    output
                        .result
                        .as_ref()
                        .and_then(|result| match result.validate() {
                            Ok(()) => {
                                let response = JobResultResponse {
                                    job_id,
                                    status: JobState::Completed,
                                    terminal: true,
                                    result: Some(result.clone()),
                                };
                                serde_json::to_vec(&response)
                                    .map_or(true, |bytes| bytes.len() > MAX_CONTROL_BYTES)
                                    .then_some(ErrorCode::PayloadTooLarge)
                            }
                            Err(ContractError::Code(code)) => Some(code),
                            Err(ContractError::Limit(_)) => Some(ErrorCode::PayloadTooLarge),
                            Err(ContractError::IncompatibleProtocol { .. })
                            | Err(ContractError::EventHistoryGap { .. }) => {
                                Some(ErrorCode::InvalidRequest)
                            }
                        });
                if output.progress.len() > companion_contract::MAX_OBSERVATIONS
                    || output
                        .progress
                        .iter()
                        .any(|progress| progress.phase.len() > 128)
                {
                    Err(ErrorCode::PayloadTooLarge)
                } else if let Some(code) = result_error {
                    Err(code)
                } else {
                    Ok(output)
                }
            }
            Ok(Err(error)) => Err(core_error_code(&error)),
            Err(_) => Err(ErrorCode::Internal),
        };
        let mut jobs = self.jobs.lock().await;
        let job = jobs
            .get_mut(&job_id)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        job.worker_running = false;
        if cancellation.is_cancelled() || job.state == JobState::Cancelling {
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
                    job.state = JobState::Completed;
                    append_event(job_id, job, JobEvent::Completed);
                }
                Err(code) => {
                    job.state = JobState::Failed;
                    append_event(job_id, job, JobEvent::Failed { code });
                }
            }
        }
        job.last_touched = Instant::now();
        let released = remove_job_input(job);
        if released > 0 {
            let mut stored = self.storage_bytes.lock().await;
            *stored = stored.saturating_sub(released);
        }
        Ok(())
    }

    pub async fn cancel(&self, owner_session: Uuid, job_id: Uuid) -> Result<(), ContractError> {
        self.cleanup_expired().await;
        let mut jobs = self.jobs.lock().await;
        let job = jobs
            .get_mut(&job_id)
            .filter(|job| job.owner_session == owner_session)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        match job.state {
            JobState::Completed | JobState::Cancelled | JobState::Failed => return Ok(()),
            JobState::Created | JobState::Receiving | JobState::Queued => {
                job.cancellation.cancel();
                job.state = JobState::Cancelled;
                append_event(job_id, job, JobEvent::Cancelled);
                job.last_touched = Instant::now();
                let released = remove_job_input(job);
                if released > 0 {
                    let mut stored = self.storage_bytes.lock().await;
                    *stored = stored.saturating_sub(released);
                }
                return Ok(());
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
        owner_session: Uuid,
        job_id: Uuid,
        after: u64,
        limit: usize,
        wait: Duration,
    ) -> Result<EventsPage, ContractError> {
        self.cleanup_expired().await;
        let limit = limit.clamp(1, MAX_EVENT_QUEUE);
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            let notified = {
                let jobs = self.jobs.lock().await;
                let job = jobs
                    .get(&job_id)
                    .filter(|job| job.owner_session == owner_session)
                    .ok_or(ContractError::Code(ErrorCode::NotFound))?;
                let earliest_sequence = job
                    .events
                    .first()
                    .map(|event| event.sequence)
                    .unwrap_or(job.event_sequence.saturating_add(1));
                if after.saturating_add(1) < earliest_sequence {
                    return Err(ContractError::EventHistoryGap { earliest_sequence });
                }
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
                    let page = EventsPage {
                        events,
                        next_sequence,
                        earliest_sequence,
                        history_truncated: earliest_sequence > 1,
                        terminal,
                    };
                    if serde_json::to_vec(&page)
                        .map_or(true, |bytes| bytes.len() > MAX_CONTROL_BYTES)
                    {
                        return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
                    }
                    return Ok(page);
                }
                Arc::clone(&job.notify)
            };
            tokio::select! {
                _ = notified.notified() => {}
                _ = tokio::time::sleep_until(deadline) => {
                    let jobs = self.jobs.lock().await;
                    let job = jobs
                        .get(&job_id)
                        .filter(|job| job.owner_session == owner_session)
                        .ok_or(ContractError::Code(ErrorCode::NotFound))?;
                    let earliest_sequence = job.events
                        .first()
                        .map(|event| event.sequence)
                        .unwrap_or(job.event_sequence.saturating_add(1));
                    if after.saturating_add(1) < earliest_sequence {
                        return Err(ContractError::EventHistoryGap { earliest_sequence });
                    }
                    let page = EventsPage {
                        events: Vec::new(),
                        next_sequence: after,
                        earliest_sequence,
                        history_truncated: earliest_sequence > 1,
                        terminal: is_terminal(job.state),
                    };
                    if serde_json::to_vec(&page).map_or(true, |bytes| bytes.len() > MAX_CONTROL_BYTES) {
                        return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
                    }
                    return Ok(page);
                }
            }
        }
    }

    pub async fn result(
        &self,
        owner_session: Uuid,
        job_id: Uuid,
    ) -> Result<JobResultResponse, ContractError> {
        self.cleanup_expired().await;
        let jobs = self.jobs.lock().await;
        let job = jobs
            .get(&job_id)
            .filter(|job| job.owner_session == owner_session)
            .ok_or(ContractError::Code(ErrorCode::NotFound))?;
        let response = JobResultResponse {
            job_id,
            status: job.state,
            terminal: is_terminal(job.state),
            result: job.result.clone(),
        };
        if serde_json::to_vec(&response).map_or(true, |bytes| bytes.len() > MAX_CONTROL_BYTES) {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        Ok(response)
    }

    pub async fn cleanup_loop(self: Arc<Self>, cancellation: CancellationToken) {
        loop {
            tokio::select! {
                _ = cancellation.cancelled() => break,
                _ = tokio::time::sleep(Duration::from_secs(30)) => self.cleanup_expired().await,
            }
        }
    }

    pub async fn cleanup_expired(&self) {
        let now = Instant::now();
        let mut release_bytes = 0_u64;
        let mut removed = Vec::new();
        let mut jobs = self.jobs.lock().await;
        for (job_id, job) in jobs.iter_mut() {
            let abandoned = matches!(
                job.state,
                JobState::Created | JobState::Receiving | JobState::Queued
            ) && now.duration_since(job.last_touched) >= self.abandoned_ttl;
            if abandoned {
                job.cancellation.cancel();
                job.state = JobState::Cancelled;
                job.last_touched = now;
                append_event(*job_id, job, JobEvent::Cancelled);
                release_bytes = release_bytes.saturating_add(remove_job_input(job));
            } else if is_terminal(job.state)
                && !job.worker_running
                && now.duration_since(job.last_touched) >= self.retention
            {
                removed.push(*job_id);
            }
        }
        for id in &removed {
            if let Some(mut job) = jobs.remove(id) {
                release_bytes = release_bytes.saturating_add(remove_job_input(&mut job));
            }
        }
        if release_bytes > 0 {
            let mut stored = self.storage_bytes.lock().await;
            *stored = stored.saturating_sub(release_bytes);
        }
        drop(jobs);
        if !removed.is_empty() {
            let removed = removed
                .into_iter()
                .collect::<std::collections::HashSet<_>>();
            self.idempotency
                .lock()
                .await
                .retain(|_, record| !removed.contains(&record.job_id));
        }
    }
}

fn default_storage_dir() -> PathBuf {
    let root = std::env::temp_dir().join("glyphmend").join("companion");
    let _ = cleanup_stale_instances(&root, Duration::from_secs(ABANDONED_JOB_TTL_SECS));
    root.join(format!("instance-{}", Uuid::new_v4()))
}

fn create_private_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn cleanup_stale_instances(root: &Path, ttl: Duration) -> std::io::Result<()> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type()?.is_dir()
            || !entry.file_name().to_string_lossy().starts_with("instance-")
        {
            continue;
        }
        let mut newest = entry
            .metadata()?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);
        for file in fs::read_dir(&path)?.flatten() {
            if let Ok(modified) = file.metadata().and_then(|metadata| metadata.modified()) {
                newest = newest.max(modified);
            }
        }
        if now.duration_since(newest).unwrap_or_default() >= ttl {
            let _ = fs::remove_dir_all(path);
        }
    }
    Ok(())
}

fn storage_quota_allows(runtime_bytes: u64, session_bytes: u64, addition: u64) -> bool {
    runtime_bytes.saturating_add(addition) <= MAX_RUNTIME_BYTES
        && session_bytes.saturating_add(addition) <= MAX_SESSION_BYTES
}

fn remove_job_input(job: &mut JobRecord) -> u64 {
    let bytes = job.bytes;
    match fs::remove_file(&job.input_path) {
        Ok(()) => {
            job.bytes = 0;
            bytes
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            job.bytes = 0;
            bytes
        }
        Err(_) => 0,
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
        CoreError::Contract(ContractError::EventHistoryGap { .. }) => ErrorCode::EventHistoryGap,
        CoreError::Contract(ContractError::Limit(_)) => ErrorCode::PayloadTooLarge,
        CoreError::InvalidTransition { .. } | CoreError::Provider(_) => ErrorCode::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use companion_contract::{MAX_ACTIVE_JOBS, MAX_EVENT_QUEUE};

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

    fn manager() -> JobManager {
        let directory =
            std::env::temp_dir().join(format!("glyphmend-service-test-{}", Uuid::new_v4()));
        JobManager::with_storage_dir(Arc::new(DiagnosticMockProvider), directory).unwrap()
    }

    async fn create_completed(manager: &JobManager, owner: Uuid) -> Uuid {
        let job = manager.create(owner, request(0)).await.unwrap();
        manager
            .complete_input(
                owner,
                job,
                InputComplete {
                    sha256_hex: hex::encode(Sha256::digest(b"")),
                    total_bytes: 0,
                },
            )
            .await
            .unwrap();
        job
    }

    #[tokio::test]
    async fn persists_chunks_accepts_identical_retries_and_completes() {
        let manager = manager();
        let owner = Uuid::new_v4();
        let job = manager.create(owner, request(3)).await.unwrap();
        let chunk = InputChunk {
            chunk_sequence: 0,
            declared_length: 3,
        };
        manager
            .append_chunk(owner, job, chunk.clone(), Bytes::from_static(b"pdf"))
            .await
            .unwrap();
        manager
            .append_chunk(owner, job, chunk, Bytes::from_static(b"pdf"))
            .await
            .unwrap();
        let complete = InputComplete {
            sha256_hex: hex::encode(Sha256::digest(b"pdf")),
            total_bytes: 3,
        };
        assert!(manager
            .complete_input(owner, job, complete.clone())
            .await
            .unwrap());
        assert!(!manager.complete_input(owner, job, complete).await.unwrap());
        assert!(matches!(
            manager
                .complete_input(
                    owner,
                    job,
                    InputComplete {
                        sha256_hex: "b".repeat(64),
                        total_bytes: 3,
                    }
                )
                .await,
            Err(ContractError::Code(ErrorCode::Conflict))
        ));
        manager.run_queued(job).await.unwrap();
        let page = manager
            .events_after(owner, job, 0, 64, Duration::ZERO)
            .await
            .unwrap();
        assert!(page
            .events
            .windows(2)
            .all(|events| events[0].sequence < events[1].sequence));
        assert!(page.terminal);
        assert!(manager.result(owner, job).await.unwrap().result.is_some());
    }

    #[tokio::test]
    async fn rejects_reordered_and_conflicting_chunks_and_hides_jobs_from_other_sessions() {
        let manager = manager();
        let owner = Uuid::new_v4();
        let other = Uuid::new_v4();
        let job = manager.create(owner, request(1)).await.unwrap();
        let first = InputChunk {
            chunk_sequence: 0,
            declared_length: 1,
        };
        assert_eq!(
            manager
                .append_chunk(
                    owner,
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
            .append_chunk(owner, job, first.clone(), Bytes::from_static(b"x"))
            .await
            .unwrap();
        assert_eq!(
            manager
                .append_chunk(owner, job, first, Bytes::from_static(b"y"))
                .await,
            Err(ContractError::Code(ErrorCode::Conflict))
        );
        assert!(matches!(
            manager.result(other, job).await,
            Err(ContractError::Code(ErrorCode::NotFound))
        ));
        assert!(matches!(
            manager.cancel(other, job).await,
            Err(ContractError::Code(ErrorCode::NotFound))
        ));
        manager.cancel(owner, job).await.unwrap();
        manager.cancel(owner, job).await.unwrap();
    }

    #[tokio::test]
    async fn concurrent_idempotency_is_atomic_per_session() {
        let manager = Arc::new(manager());
        let owner = Uuid::new_v4();
        let original = request(0);
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let manager = Arc::clone(&manager);
            let request = original.clone();
            tasks.push(tokio::spawn(async move {
                manager.create(owner, request).await.unwrap()
            }));
        }
        let mut ids = Vec::new();
        for task in tasks {
            ids.push(task.await.unwrap());
        }
        assert!(ids.iter().all(|id| *id == ids[0]));
        let mut changed = original.clone();
        changed.document_name = "different.pdf".into();
        assert_eq!(
            manager.create(owner, changed).await,
            Err(ContractError::Code(ErrorCode::Conflict))
        );
        let other_job = manager.create(Uuid::new_v4(), request(0)).await.unwrap();
        assert_ne!(ids[0], other_job);
    }

    #[tokio::test]
    async fn concurrent_completion_retries_queue_exactly_once() {
        let manager = Arc::new(manager());
        let owner = Uuid::new_v4();
        let job = manager.create(owner, request(0)).await.unwrap();
        let complete = InputComplete {
            sha256_hex: hex::encode(Sha256::digest(b"")),
            total_bytes: 0,
        };
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let manager = Arc::clone(&manager);
            let complete = complete.clone();
            tasks.push(tokio::spawn(async move {
                manager.complete_input(owner, job, complete).await.unwrap()
            }));
        }
        let mut queued = 0;
        for task in tasks {
            if task.await.unwrap() {
                queued += 1;
            }
        }
        assert_eq!(queued, 1);
    }

    #[test]
    fn enforces_runtime_and_session_storage_boundaries_without_overflow() {
        assert!(storage_quota_allows(
            MAX_RUNTIME_BYTES - 1,
            MAX_SESSION_BYTES - 1,
            1
        ));
        assert!(!storage_quota_allows(MAX_RUNTIME_BYTES, 0, 1));
        assert!(!storage_quota_allows(0, MAX_SESSION_BYTES, 1));
        assert!(!storage_quota_allows(u64::MAX, u64::MAX, 1));
    }

    #[tokio::test]
    async fn enforces_active_job_quota() {
        let manager = manager();
        let owner = Uuid::new_v4();
        for _ in 0..MAX_ACTIVE_JOBS {
            manager.create(owner, request(0)).await.unwrap();
        }
        assert_eq!(
            manager.create(owner, request(0)).await,
            Err(ContractError::Code(ErrorCode::Busy))
        );
    }

    #[tokio::test]
    async fn reports_event_history_gaps_after_bounded_replay_overflows() {
        let manager = manager();
        let owner = Uuid::new_v4();
        let job_id = manager.create(owner, request(0)).await.unwrap();
        {
            let mut jobs = manager.jobs.lock().await;
            let job = jobs.get_mut(&job_id).unwrap();
            for _ in 0..=MAX_EVENT_QUEUE {
                append_event(job_id, job, JobEvent::Queued);
            }
        }
        assert!(matches!(
            manager
                .events_after(owner, job_id, 0, 16, Duration::ZERO)
                .await,
            Err(ContractError::EventHistoryGap {
                earliest_sequence: 2
            })
        ));
        let page = manager
            .events_after(owner, job_id, 1, 16, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(page.earliest_sequence, 2);
        assert!(page.history_truncated);
    }

    #[tokio::test]
    async fn cleanup_expires_abandoned_jobs_and_input() {
        let directory =
            std::env::temp_dir().join(format!("glyphmend-service-test-{}", Uuid::new_v4()));
        let manager =
            JobManager::with_storage_dir(Arc::new(DiagnosticMockProvider), directory.clone())
                .unwrap()
                .with_abandoned_ttl(Duration::ZERO);
        let job = manager.create(Uuid::new_v4(), request(0)).await.unwrap();
        manager.cleanup_expired().await;
        assert!(matches!(
            manager.result(Uuid::new_v4(), job).await,
            Err(ContractError::Code(ErrorCode::NotFound))
        ));
        assert!(!directory.join(format!("{job}.input")).exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn startup_cleanup_removes_only_stale_companion_instances() {
        let root = std::env::temp_dir().join(format!("glyphmend-instance-test-{}", Uuid::new_v4()));
        let stale = root.join("instance-stale");
        let unrelated = root.join("keep-me");
        fs::create_dir_all(&stale).unwrap();
        fs::create_dir_all(&unrelated).unwrap();
        fs::write(stale.join("input.bin"), b"private input").unwrap();
        cleanup_stale_instances(&root, Duration::ZERO).unwrap();
        assert!(!stale.exists());
        assert!(unrelated.exists());
        let _ = fs::remove_dir_all(root);
    }

    struct SlowProvider;

    impl CapabilityProvider for SlowProvider {
        fn capability(&self) -> Capability {
            DiagnosticMockProvider.capability()
        }
        fn run(
            &self,
            input: ProviderInput,
            cancellation: CancellationToken,
        ) -> Result<companion_core::ProviderOutput, CoreError> {
            std::thread::sleep(Duration::from_millis(50));
            DiagnosticMockProvider.run(input, cancellation)
        }
    }

    struct ConcurrencyProvider {
        active: Arc<std::sync::atomic::AtomicUsize>,
        maximum: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl CapabilityProvider for ConcurrencyProvider {
        fn capability(&self) -> Capability {
            DiagnosticMockProvider.capability()
        }
        fn run(
            &self,
            input: ProviderInput,
            cancellation: CancellationToken,
        ) -> Result<companion_core::ProviderOutput, CoreError> {
            use std::sync::atomic::Ordering;
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.maximum.fetch_max(active, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(50));
            self.active.fetch_sub(1, Ordering::SeqCst);
            DiagnosticMockProvider.run(input, cancellation)
        }
    }

    #[tokio::test]
    async fn bounds_running_providers_to_two() {
        use std::sync::atomic::Ordering;
        let directory =
            std::env::temp_dir().join(format!("glyphmend-service-test-{}", Uuid::new_v4()));
        let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let maximum = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let provider = ConcurrencyProvider {
            active,
            maximum: Arc::clone(&maximum),
        };
        let manager =
            Arc::new(JobManager::with_providers(vec![Arc::new(provider)], directory).unwrap());
        let owner = Uuid::new_v4();
        let mut jobs = Vec::new();
        for _ in 0..3 {
            jobs.push(create_completed(&manager, owner).await);
        }
        let mut tasks = Vec::new();
        for job in jobs {
            let manager = Arc::clone(&manager);
            tasks.push(tokio::spawn(async move {
                manager.run_queued(job).await.unwrap();
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        assert_eq!(maximum.load(Ordering::SeqCst), 2);
    }

    struct CancellationObservingProvider {
        started: Arc<std::sync::atomic::AtomicBool>,
        observed: Arc<std::sync::atomic::AtomicBool>,
    }

    impl CapabilityProvider for CancellationObservingProvider {
        fn capability(&self) -> Capability {
            DiagnosticMockProvider.capability()
        }
        fn run(
            &self,
            input: ProviderInput,
            cancellation: CancellationToken,
        ) -> Result<companion_core::ProviderOutput, CoreError> {
            self.started
                .store(true, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(50));
            self.observed.store(
                cancellation.is_cancelled(),
                std::sync::atomic::Ordering::SeqCst,
            );
            DiagnosticMockProvider.run(input, cancellation)
        }
    }

    #[tokio::test]
    async fn propagates_cancellation_to_running_provider() {
        let directory =
            std::env::temp_dir().join(format!("glyphmend-service-test-{}", Uuid::new_v4()));
        let started = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let observed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let provider = CancellationObservingProvider {
            started: Arc::clone(&started),
            observed: Arc::clone(&observed),
        };
        let manager = Arc::new(
            JobManager::with_providers(vec![Arc::new(provider)], directory)
                .unwrap()
                .with_provider_timeout(Duration::from_secs(1)),
        );
        let owner = Uuid::new_v4();
        let job = create_completed(&manager, owner).await;
        let running_manager = Arc::clone(&manager);
        let running = tokio::spawn(async move {
            running_manager.run_queued(job).await.unwrap();
        });
        tokio::time::timeout(Duration::from_secs(1), async {
            while !started.load(std::sync::atomic::Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .unwrap();
        manager.cancel(owner, job).await.unwrap();
        running.await.unwrap();
        assert!(observed.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(
            manager.result(owner, job).await.unwrap().status,
            JobState::Cancelled
        );
    }

    #[tokio::test]
    async fn synchronous_provider_work_does_not_block_tokio_workers() {
        let directory =
            std::env::temp_dir().join(format!("glyphmend-service-test-{}", Uuid::new_v4()));
        let manager = Arc::new(
            JobManager::with_providers(vec![Arc::new(SlowProvider)], directory)
                .unwrap()
                .with_provider_timeout(Duration::from_secs(1)),
        );
        let owner = Uuid::new_v4();
        let job = create_completed(&manager, owner).await;
        let running_manager = Arc::clone(&manager);
        let running = tokio::spawn(async move {
            running_manager.run_queued(job).await.unwrap();
        });
        tokio::time::timeout(
            Duration::from_millis(25),
            tokio::time::sleep(Duration::from_millis(10)),
        )
        .await
        .expect("Tokio timer should progress while provider runs");
        running.await.unwrap();
        assert_eq!(
            manager.result(owner, job).await.unwrap().status,
            JobState::Completed
        );
    }

    #[tokio::test]
    async fn times_out_synchronous_providers() {
        let directory =
            std::env::temp_dir().join(format!("glyphmend-service-test-{}", Uuid::new_v4()));
        let manager = JobManager::with_providers_and_retention(
            vec![Arc::new(SlowProvider)],
            directory,
            Duration::from_secs(60),
        )
        .unwrap()
        .with_provider_timeout(Duration::from_millis(5));
        let owner = Uuid::new_v4();
        let job = create_completed(&manager, owner).await;
        let timer_fired = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let timer_fired_copy = Arc::clone(&timer_fired);
        let timer = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            timer_fired_copy.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        manager.run_queued(job).await.unwrap();
        timer.await.unwrap();
        assert!(timer_fired.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(
            manager.result(owner, job).await.unwrap().status,
            JobState::Failed
        );
        tokio::time::sleep(Duration::from_millis(60)).await;
    }
}
