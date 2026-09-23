//! Tauri adapter only. Commands delegate to the shared service layer.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use companion_contract::{InputChunk, InputComplete, JobCreate, MAX_CHUNK_BYTES};
use companion_service::{EventsPage, JobManager, JobResultResponse};
use std::{sync::Arc, time::Duration};
use tauri::State;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

struct Runtime(Arc<JobManager>, CancellationToken);

impl Drop for Runtime {
    fn drop(&mut self) {
        self.1.cancel();
    }
}

#[tauri::command]
async fn companion_capabilities(
    runtime: State<'_, Runtime>,
) -> Result<Vec<companion_contract::Capability>, String> {
    runtime.0.capabilities().map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_create_job(
    runtime: State<'_, Runtime>,
    request: JobCreate,
) -> Result<String, String> {
    runtime
        .0
        .create(Uuid::nil(), request)
        .await
        .map(|id| id.to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_append_chunk(
    runtime: State<'_, Runtime>,
    job_id: String,
    sequence: u64,
    body: Vec<u8>,
) -> Result<(), String> {
    if body.len() > MAX_CHUNK_BYTES {
        return Err("input chunk exceeds 1 MiB".into());
    }
    let id = parse_job_id(&job_id)?;
    runtime
        .0
        .append_chunk(
            Uuid::nil(),
            id,
            InputChunk {
                chunk_sequence: sequence,
                declared_length: body.len() as u32,
            },
            body.into(),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_complete_job(
    runtime: State<'_, Runtime>,
    job_id: String,
    request: InputComplete,
) -> Result<(), String> {
    let id = parse_job_id(&job_id)?;
    let should_run = runtime
        .0
        .complete_input(Uuid::nil(), id, request)
        .await
        .map_err(|error| error.to_string())?;
    if should_run {
        let service = Arc::clone(&runtime.0);
        tauri::async_runtime::spawn(async move {
            let _ = service.run_queued(id).await;
        });
    }
    Ok(())
}

#[tauri::command]
async fn companion_job_events(
    runtime: State<'_, Runtime>,
    job_id: String,
    after: u64,
    wait_ms: u64,
) -> Result<EventsPage, String> {
    let id = parse_job_id(&job_id)?;
    runtime
        .0
        .events_after(
            Uuid::nil(),
            id,
            after,
            128,
            Duration::from_millis(wait_ms.min(15_000)),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_job_result(
    runtime: State<'_, Runtime>,
    job_id: String,
) -> Result<JobResultResponse, String> {
    runtime
        .0
        .result(Uuid::nil(), parse_job_id(&job_id)?)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_cancel_job(runtime: State<'_, Runtime>, job_id: String) -> Result<(), String> {
    runtime
        .0
        .cancel(Uuid::nil(), parse_job_id(&job_id)?)
        .await
        .map_err(|error| error.to_string())
}

fn parse_job_id(value: &str) -> Result<Uuid, String> {
    value
        .parse()
        .map_err(|_| "The companion rejected the job identifier.".into())
}

fn main() {
    let service = Arc::new(JobManager::default());
    let cleanup_cancellation = CancellationToken::new();
    tauri::async_runtime::spawn(Arc::clone(&service).cleanup_loop(cleanup_cancellation.clone()));
    tauri::Builder::default()
        .manage(Runtime(service, cleanup_cancellation))
        .invoke_handler(tauri::generate_handler![
            companion_capabilities,
            companion_create_job,
            companion_append_chunk,
            companion_complete_job,
            companion_job_events,
            companion_job_result,
            companion_cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("Tauri companion could not start");
}
