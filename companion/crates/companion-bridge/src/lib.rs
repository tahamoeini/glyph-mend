//! Authenticated, loopback-only HTTP bridge.
#![forbid(unsafe_code)]

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use companion_contract::{
    ContractError, ErrorCode, InputChunk, InputComplete, JobCreate, ProtocolVersion,
    SessionRequest, IR_SCHEMA_VERSION, PAIRING_TTL_SECS, SESSION_IDLE_SECS,
};
use companion_service::{JobManager, JobResultResponse};
use getrandom::fill;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex},
};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
    trace::TraceLayer,
};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

pub const DEFAULT_ORIGINS: &[&str] = &[
    "https://glyphmend.negar.team",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
];

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub bind: SocketAddr,
    pub approved_origins: HashSet<String>,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            bind: "127.0.0.1:0".parse().expect("literal socket"),
            approved_origins: DEFAULT_ORIGINS.iter().map(ToString::to_string).collect(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("the bridge may bind only to a loopback address")]
    NonLoopbackBinding,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone)]
struct AppState {
    service: Arc<JobManager>,
    approved_origins: Arc<HashSet<String>>,
    auth: Arc<Mutex<AuthState>>,
}

struct AuthState {
    pairing_code: Zeroizing<Vec<u8>>,
    pairing_expires: Instant,
    used: bool,
    sessions: HashMap<Uuid, Session>,
}

struct Session {
    token: Zeroizing<Vec<u8>>,
    origin: String,
    last_used: Instant,
}

pub struct BridgeHandle {
    pub endpoint: String,
    pub pairing_code: String,
    shutdown: Option<oneshot::Sender<()>>,
}

impl BridgeHandle {
    pub async fn shutdown(mut self) {
        if let Some(sender) = self.shutdown.take() {
            let _ = sender.send(());
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventQuery {
    after: Option<u64>,
    limit: Option<usize>,
    wait_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    protocol_version: ProtocolVersion,
    ir_schema_version: u16,
    session_id: Uuid,
    session_token: String,
    expires_in_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    code: ErrorCode,
    detail: &'static str,
}

pub async fn start(
    config: BridgeConfig,
    service: Arc<JobManager>,
) -> Result<BridgeHandle, BridgeError> {
    if !config.bind.ip().is_loopback() {
        return Err(BridgeError::NonLoopbackBinding);
    }
    let listener = TcpListener::bind(config.bind).await?;
    let address = listener.local_addr()?;
    let pairing_code = new_secret(16);
    let headers: Vec<HeaderValue> = config
        .approved_origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();
    let state = AppState {
        service,
        approved_origins: Arc::new(config.approved_origins),
        auth: Arc::new(Mutex::new(AuthState {
            pairing_code: Zeroizing::new(pairing_code.as_bytes().to_vec()),
            pairing_expires: Instant::now() + Duration::from_secs(PAIRING_TTL_SECS),
            used: false,
            sessions: HashMap::new(),
        })),
    };
    let app = Router::new()
        .route("/v1/session", post(session))
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/jobs", post(create_job))
        .route("/v1/jobs/{job_id}/chunks/{sequence}", put(input_chunk))
        .route("/v1/jobs/{job_id}/complete", post(complete_input))
        .route("/v1/jobs/{job_id}/cancel", post(cancel_job))
        .route("/v1/jobs/{job_id}/events", get(events))
        .route("/v1/jobs/{job_id}/result", get(result))
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(
            companion_contract::MAX_CHUNK_BYTES,
        ))
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(headers))
                .allow_methods([Method::GET, Method::POST, Method::PUT])
                .allow_headers([
                    header::AUTHORIZATION,
                    header::CONTENT_TYPE,
                    HeaderName::from_static("x-glyphmend-chunk-length"),
                ]),
        );
    let (shutdown, receiver) = oneshot::channel();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = receiver.await;
            })
            .await;
    });
    Ok(BridgeHandle {
        endpoint: format!("http://{}", address),
        pairing_code,
        shutdown: Some(shutdown),
    })
}

async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SessionRequest>,
) -> Response {
    if let Err(response) = trusted_origin(&state, &headers) {
        return response;
    }
    if request.ir_schema_version != IR_SCHEMA_VERSION
        || ProtocolVersion::CURRENT
            .negotiate(request.protocol_version)
            .is_err()
    {
        return reject(ErrorCode::ProtocolIncompatible);
    }
    let mut auth = state.auth.lock().await;
    let valid = !auth.used
        && Instant::now() <= auth.pairing_expires
        && auth
            .pairing_code
            .as_slice()
            .ct_eq(request.pairing_code.as_bytes())
            .into();
    if !valid {
        return reject(ErrorCode::PairingRequired);
    }
    auth.used = true;
    auth.pairing_code.zeroize();
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let session_id = Uuid::new_v4();
    let token = new_secret(32);
    auth.sessions.insert(
        session_id,
        Session {
            token: Zeroizing::new(token.as_bytes().to_vec()),
            origin,
            last_used: Instant::now(),
        },
    );
    Json(SessionResponse {
        protocol_version: ProtocolVersion::CURRENT,
        ir_schema_version: IR_SCHEMA_VERSION,
        session_id,
        session_token: token,
        expires_in_seconds: SESSION_IDLE_SECS,
    })
    .into_response()
}

async fn capabilities(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = authenticated(&state, &headers).await {
        return response;
    }
    Json(state.service.capabilities()).into_response()
}

async fn create_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<JobCreate>,
) -> Response {
    if let Err(response) = authenticated(&state, &headers).await {
        return response;
    }
    match state.service.create(request).await {
        Ok(job_id) => Json(serde_json::json!({ "jobId": job_id })).into_response(),
        Err(error) => contract_response(error),
    }
}

async fn input_chunk(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((job_id, sequence)): Path<(Uuid, u64)>,
    body: Bytes,
) -> Response {
    if let Err(response) = authenticated(&state, &headers).await {
        return response;
    }
    let declared_length = headers
        .get("x-glyphmend-chunk-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(body.len() as u32);
    match state
        .service
        .append_chunk(
            job_id,
            InputChunk {
                chunk_sequence: sequence,
                declared_length,
            },
            body,
        )
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => contract_response(error),
    }
}

async fn complete_input(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
    Json(request): Json<InputComplete>,
) -> Response {
    if let Err(response) = authenticated(&state, &headers).await {
        return response;
    }
    if let Err(error) = state.service.complete_input(job_id, request).await {
        return contract_response(error);
    }
    let service = Arc::clone(&state.service);
    tokio::spawn(async move {
        let _ = service.run_queued(job_id).await;
    });
    StatusCode::ACCEPTED.into_response()
}

async fn cancel_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Response {
    if let Err(response) = authenticated(&state, &headers).await {
        return response;
    }
    match state.service.cancel(job_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => contract_response(error),
    }
}

async fn events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
    Query(query): Query<EventQuery>,
) -> Response {
    if let Err(response) = authenticated(&state, &headers).await {
        return response;
    }
    let after = query.after.unwrap_or(0);
    let limit = query
        .limit
        .unwrap_or(64)
        .min(companion_contract::MAX_EVENT_QUEUE);
    let wait = Duration::from_millis(query.wait_ms.unwrap_or(15_000).min(15_000));
    match state.service.events_after(job_id, after, limit, wait).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => contract_response(error),
    }
}

async fn result(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Response {
    if let Err(response) = authenticated(&state, &headers).await {
        return response;
    }
    match state.service.result(job_id).await {
        Ok(value) => Json::<JobResultResponse>(value).into_response(),
        Err(error) => contract_response(error),
    }
}

fn trusted_origin(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    state
        .approved_origins
        .contains(origin)
        .then_some(())
        .ok_or_else(|| reject(ErrorCode::SecurityRejected))
}

async fn authenticated(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    trusted_origin(state, headers)?;
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let mut auth = state.auth.lock().await;
    let session = auth.sessions.values_mut().find(|session| {
        session.token.as_slice().ct_eq(value.as_bytes()).into()
            && session.origin == origin
            && session.last_used.elapsed() <= Duration::from_secs(SESSION_IDLE_SECS)
    });
    if let Some(session) = session {
        session.last_used = Instant::now();
        Ok(())
    } else {
        Err(reject(ErrorCode::SessionExpired))
    }
}

fn new_secret(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    fill(&mut value).expect("OS randomness unavailable");
    hex::encode(value)
}

fn reject(code: ErrorCode) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(ErrorResponse {
            code,
            detail: "Request rejected by the local companion.",
        }),
    )
        .into_response()
}

fn contract_response(error: ContractError) -> Response {
    let code = match error {
        ContractError::Code(code) => code,
        ContractError::IncompatibleProtocol { .. } => ErrorCode::ProtocolIncompatible,
        ContractError::Limit(_) => ErrorCode::PayloadTooLarge,
    };
    let status = match code {
        ErrorCode::NotFound => StatusCode::NOT_FOUND,
        ErrorCode::Conflict => StatusCode::CONFLICT,
        ErrorCode::SessionExpired | ErrorCode::PairingRequired | ErrorCode::SecurityRejected => {
            StatusCode::FORBIDDEN
        }
        _ => StatusCode::BAD_REQUEST,
    };
    (
        status,
        Json(ErrorResponse {
            code,
            detail: "The companion rejected the request.",
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use companion_service::JobManager;

    #[tokio::test]
    async fn rejects_non_loopback_bindings() {
        let config = BridgeConfig {
            bind: "192.168.1.2:0".parse().unwrap(),
            approved_origins: HashSet::new(),
        };
        assert!(matches!(
            start(config, Arc::new(JobManager::default())).await,
            Err(BridgeError::NonLoopbackBinding)
        ));
    }
}
