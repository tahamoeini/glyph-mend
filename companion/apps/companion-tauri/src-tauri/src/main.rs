//! Tauri adapter only. Commands delegate to the shared service layer.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use companion_contract::{InputChunk, InputComplete, JobCreate};
use companion_service::{EventsPage, JobManager, JobResultResponse};
use std::{sync::Arc, time::Duration};
use tauri::State;
use uuid::Uuid;

struct Runtime(Arc<JobManager>);

#[tauri::command]
async fn companion_capabilities(
    runtime: State<'_, Runtime>,
) -> Vec<companion_contract::Capability> {
    runtime.0.capabilities()
}

#[tauri::command]
async fn companion_create_job(
    runtime: State<'_, Runtime>,
    request: JobCreate,
) -> Result<String, String> {
    runtime
        .0
        .create(request)
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
    let id = parse_job_id(&job_id)?;
    runtime
        .0
        .append_chunk(
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
    runtime
        .0
        .complete_input(id, request)
        .await
        .map_err(|error| error.to_string())?;
    let service = Arc::clone(&runtime.0);
    tauri::async_runtime::spawn(async move {
        let _ = service.run_queued(id).await;
    });
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
        .events_after(id, after, 128, Duration::from_millis(wait_ms.min(15_000)))
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
        .result(parse_job_id(&job_id)?)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_cancel_job(runtime: State<'_, Runtime>, job_id: String) -> Result<(), String> {
    runtime
        .0
        .cancel(parse_job_id(&job_id)?)
        .await
        .map_err(|error| error.to_string())
}

fn parse_job_id(value: &str) -> Result<Uuid, String> {
    value
        .parse()
        .map_err(|_| "The companion rejected the job identifier.".into())
}

fn main() {
    tauri::Builder::default()
        .manage(Runtime(Arc::new(JobManager::default())))
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
