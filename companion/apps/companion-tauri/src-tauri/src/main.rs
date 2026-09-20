//! Tauri adapter only. Commands delegate to the shared service layer.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use companion_contract::JobCreate;
use companion_service::JobManager;
use std::sync::Arc;
use tauri::State;

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
        .map_err(|_| "The companion rejected the request.".into())
}

#[tauri::command]
async fn companion_cancel_job(runtime: State<'_, Runtime>, job_id: String) -> Result<(), String> {
    let id = job_id
        .parse()
        .map_err(|_| "The companion rejected the request.".to_string())?;
    runtime
        .0
        .cancel(id)
        .await
        .map_err(|_| "The companion rejected the request.".into())
}

fn main() {
    tauri::Builder::default()
        .manage(Runtime(Arc::new(JobManager::default())))
        .invoke_handler(tauri::generate_handler![
            companion_capabilities,
            companion_create_job,
            companion_cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("Tauri companion could not start");
}
