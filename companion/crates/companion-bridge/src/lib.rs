//! Authenticated, loopback-only HTTP bridge.
#![forbid(unsafe_code)]

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri},
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
use tokio_util::sync::CancellationToken;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
    trace::TraceLayer,
};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

pub const DEFAULT_WEB_ORIGIN: &str = "https://glyphmend.negar.team";

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub bind: SocketAddr,
    pub approved_origins: HashSet<String>,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            bind: "127.0.0.1:0".parse().expect("literal socket"),
            approved_origins: HashSet::from([DEFAULT_WEB_ORIGIN.to_string()]),
        }
    }
}

impl BridgeConfig {
    pub fn for_web_origin(web_origin: &str) -> Result<Self, BridgeError> {
        let origin = normalize_web_origin(web_origin)?;
        Ok(Self {
            bind: "127.0.0.1:0".parse().expect("literal socket"),
            approved_origins: HashSet::from([origin]),
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("the bridge may bind only to a loopback address")]
    NonLoopbackBinding,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error(
        "web origin must be an exact http or https origin without credentials, path, or wildcard"
    )]
    InvalidWebOrigin,
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
    protocol_version: ProtocolVersion,
    last_used: Instant,
}

pub struct BridgeHandle {
    pub endpoint: String,
    pub pairing_code: String,
    shutdown: Option<oneshot::Sender<()>>,
    cleanup_cancellation: CancellationToken,
}

impl BridgeHandle {
    pub async fn shutdown(mut self) {
        self.cleanup_cancellation.cancel();
        if let Some(sender) = self.shutdown.take() {
            let _ = sender.send(());
        }
    }
}

impl Drop for BridgeHandle {
    fn drop(&mut self) {
        self.cleanup_cancellation.cancel();
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
    #[serde(skip_serializing_if = "Option::is_none")]
    earliest_sequence: Option<u64>,
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
    let cleanup_service = Arc::clone(&state.service);
    let control_routes = Router::new()
        .route("/v1/session", post(session))
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/jobs", post(create_job))
        .route("/v1/jobs/{job_id}/complete", post(complete_input))
        .route("/v1/jobs/{job_id}/cancel", post(cancel_job))
        .route("/v1/jobs/{job_id}/events", get(events))
        .route("/v1/jobs/{job_id}/result", get(result))
        .layer(RequestBodyLimitLayer::new(
            companion_contract::MAX_CONTROL_BYTES,
        ));
    let input_routes = Router::new()
        .route("/v1/jobs/{job_id}/chunks/{sequence}", put(input_chunk))
        .layer(RequestBodyLimitLayer::new(
            companion_contract::MAX_CHUNK_BYTES,
        ));
    let app = control_routes
        .merge(input_routes)
        .with_state(state)
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
    let cleanup_cancellation = CancellationToken::new();
    tokio::spawn(cleanup_service.cleanup_loop(cleanup_cancellation.clone()));
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
        cleanup_cancellation,
    })
}

async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SessionRequest>,
) -> Response {
    if let Err(code) = trusted_origin(&state, &headers) {
        return reject(code);
    }
    let negotiated = match request.validate() {
        Ok(version) => version,
        Err(error) => return contract_response(error),
    };
    if request.ir_schema_version != IR_SCHEMA_VERSION {
        return contract_response(ContractError::Code(ErrorCode::IrSchemaUnsupported));
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
            protocol_version: negotiated,
            last_used: Instant::now(),
        },
    );
    Json(SessionResponse {
        protocol_version: negotiated,
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
    match state.service.capabilities() {
        Ok(capabilities) => Json(capabilities).into_response(),
        Err(error) => contract_response(error),
    }
}

async fn create_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<JobCreate>,
) -> Response {
    let owner_session = match authenticated(&state, &headers).await {
        Ok(session_id) => session_id,
        Err(response) => return response,
    };
    match state.service.create(owner_session, request).await {
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
    let owner_session = match authenticated(&state, &headers).await {
        Ok(session_id) => session_id,
        Err(response) => return response,
    };
    let declared_length = headers
        .get("x-glyphmend-chunk-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(body.len() as u32);
    match state
        .service
        .append_chunk(
            owner_session,
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
    let owner_session = match authenticated(&state, &headers).await {
        Ok(session_id) => session_id,
        Err(response) => return response,
    };
    let should_run = match state
        .service
        .complete_input(owner_session, job_id, request)
        .await
    {
        Ok(should_run) => should_run,
        Err(error) => return contract_response(error),
    };
    if should_run {
        let service = Arc::clone(&state.service);
        tokio::spawn(async move {
            let _ = service.run_queued(job_id).await;
        });
    }
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({"queued": should_run})),
    )
        .into_response()
}

async fn cancel_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Response {
    let owner_session = match authenticated(&state, &headers).await {
        Ok(session_id) => session_id,
        Err(response) => return response,
    };
    match state.service.cancel(owner_session, job_id).await {
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
    let owner_session = match authenticated(&state, &headers).await {
        Ok(session_id) => session_id,
        Err(response) => return response,
    };
    let after = query.after.unwrap_or(0);
    let limit = query
        .limit
        .unwrap_or(64)
        .min(companion_contract::MAX_EVENT_QUEUE);
    let wait = Duration::from_millis(query.wait_ms.unwrap_or(15_000).min(15_000));
    match state
        .service
        .events_after(owner_session, job_id, after, limit, wait)
        .await
    {
        Ok(page) => Json(page).into_response(),
        Err(error) => contract_response(error),
    }
}

async fn result(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Response {
    let owner_session = match authenticated(&state, &headers).await {
        Ok(session_id) => session_id,
        Err(response) => return response,
    };
    match state.service.result(owner_session, job_id).await {
        Ok(value) => Json::<JobResultResponse>(value).into_response(),
        Err(error) => contract_response(error),
    }
}

fn trusted_origin(state: &AppState, headers: &HeaderMap) -> Result<(), ErrorCode> {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    state
        .approved_origins
        .contains(origin)
        .then_some(())
        .ok_or(ErrorCode::SecurityRejected)
}

async fn authenticated(state: &AppState, headers: &HeaderMap) -> Result<Uuid, Response> {
    trusted_origin(state, headers).map_err(reject)?;
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
    let session_id = auth.sessions.iter_mut().find_map(|(session_id, session)| {
        let valid = session.protocol_version.major == ProtocolVersion::CURRENT.major
            && session.token.as_slice().ct_eq(value.as_bytes()).into()
            && session.origin == origin
            && session.last_used.elapsed() <= Duration::from_secs(SESSION_IDLE_SECS);
        if valid {
            session.last_used = Instant::now();
            Some(*session_id)
        } else {
            None
        }
    });
    session_id.ok_or_else(|| reject(ErrorCode::SessionExpired))
}

fn normalize_web_origin(value: &str) -> Result<String, BridgeError> {
    let uri = value
        .parse::<Uri>()
        .map_err(|_| BridgeError::InvalidWebOrigin)?;
    let scheme = uri
        .scheme_str()
        .ok_or(BridgeError::InvalidWebOrigin)?
        .to_ascii_lowercase();
    let authority = uri.authority().ok_or(BridgeError::InvalidWebOrigin)?;
    let path = uri
        .path_and_query()
        .map(|path| path.as_str())
        .unwrap_or_default();
    if !matches!(scheme.as_str(), "http" | "https")
        || authority.host().is_empty()
        || (authority.as_str().contains('@') || authority.as_str().contains('*'))
        || !matches!(path, "" | "/")
    {
        return Err(BridgeError::InvalidWebOrigin);
    }
    let host = authority.host().to_ascii_lowercase();
    let port = authority.port_u16();
    if authority.port().is_some() && port.is_none() {
        return Err(BridgeError::InvalidWebOrigin);
    }
    let default_port = matches!(
        (scheme.as_str(), port),
        ("http", Some(80)) | ("https", Some(443))
    );
    let port_suffix = if default_port {
        "".to_string()
    } else {
        port.map_or_else(String::new, |value| format!(":{value}"))
    };
    Ok(format!("{}://{}{}", scheme, host, port_suffix))
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
            earliest_sequence: None,
        }),
    )
        .into_response()
}

fn contract_response(error: ContractError) -> Response {
    let (code, earliest_sequence) = match error {
        ContractError::Code(code) => (code, None),
        ContractError::IncompatibleProtocol { .. } => (ErrorCode::ProtocolIncompatible, None),
        ContractError::Limit(_) => (ErrorCode::PayloadTooLarge, None),
        ContractError::EventHistoryGap { earliest_sequence } => {
            (ErrorCode::EventHistoryGap, Some(earliest_sequence))
        }
    };
    let status = match code {
        ErrorCode::NotFound => StatusCode::NOT_FOUND,
        ErrorCode::Conflict | ErrorCode::EventHistoryGap => StatusCode::CONFLICT,
        ErrorCode::Busy => StatusCode::TOO_MANY_REQUESTS,
        ErrorCode::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
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
            earliest_sequence,
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use companion_service::JobManager;

    #[test]
    fn accepts_only_normalized_exact_web_origins() {
        assert_eq!(
            normalize_web_origin("HTTPS://Example.COM:443/").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_web_origin("http://localhost:8080").unwrap(),
            "http://localhost:8080"
        );
        for value in [
            "https://example.com/path",
            "https://user@example.com",
            "https://*.example.com",
            "file:///tmp",
        ] {
            assert!(matches!(
                normalize_web_origin(value),
                Err(BridgeError::InvalidWebOrigin)
            ));
        }
    }

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
