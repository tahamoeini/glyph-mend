//! Versioned, transport-neutral companion wire contract.
#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const PROTOCOL_MAJOR: u16 = 1;
pub const PROTOCOL_MINOR: u16 = 1;
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const IR_SCHEMA_ID: &str = "glyphmend.semantic-document-ir";
pub const IR_SCHEMA_VERSION: u16 = 2;
pub const PROVIDER_RESULT_SCHEMA: &str = "glyphmend.provider-result.v1";
pub const MAX_CONTROL_BYTES: usize = 64 * 1024;
pub const MAX_CHUNK_BYTES: usize = 1024 * 1024;
pub const MAX_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_EVENT_QUEUE: usize = 128;
pub const MAX_CONCURRENT_JOBS: usize = 2;
pub const CONTROL_TIMEOUT_SECS: u64 = 30;
pub const SESSION_IDLE_SECS: u64 = 15 * 60;
pub const PAIRING_TTL_SECS: u64 = 5 * 60;
pub const JOB_RETENTION_SECS: u64 = 24 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MessageType {
    Hello,
    HelloAck,
    Pair,
    PairAck,
    CapabilitiesRequest,
    CapabilitiesResponse,
    JobCreate,
    JobInputChunk,
    JobInputComplete,
    JobCancel,
    JobCancelled,
    JobResumeRequest,
    JobProgress,
    PageStarted,
    PageCompleted,
    PageFailed,
    Diagnostic,
    JobCompleted,
    JobFailed,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    ProtocolIncompatible,
    IrSchemaUnsupported,
    InvalidEnvelope,
    InvalidState,
    InvalidSequence,
    PayloadTooLarge,
    DigestMismatch,
    PairingRequired,
    SecurityRejected,
    SessionExpired,
    Busy,
    TimedOut,
    NotFound,
    Conflict,
    Cancelled,
    Internal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    Deterministic,
    HybridLocal,
    Ml,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InputKind {
    Document,
    Region,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ContractError {
    #[error("{0:?}")]
    Code(ErrorCode),
    #[error("protocol major {received} is incompatible with {supported}")]
    IncompatibleProtocol { received: u16, supported: u16 },
    #[error("field {0} exceeds its limit")]
    Limit(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtocolVersion {
    pub major: u16,
    pub minor: u16,
}

impl ProtocolVersion {
    pub const CURRENT: Self = Self {
        major: PROTOCOL_MAJOR,
        minor: PROTOCOL_MINOR,
    };

    pub fn negotiate(self, peer: Self) -> Result<Self, ContractError> {
        if self.major != peer.major {
            return Err(ContractError::IncompatibleProtocol {
                received: peer.major,
                supported: self.major,
            });
        }
        Ok(Self {
            major: self.major,
            minor: self.minor.min(peer.minor),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Envelope<T> {
    pub protocol_version: ProtocolVersion,
    pub message_type: MessageType,
    pub request_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<Uuid>,
    pub engine_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ir_schema_version: Option<u16>,
    pub sequence: u64,
    pub payload: T,
}

impl<T> Envelope<T> {
    pub fn validate_metadata(&self) -> Result<(), ContractError> {
        ProtocolVersion::CURRENT.negotiate(self.protocol_version)?;
        if self.engine_version.len() > 64 {
            return Err(ContractError::Limit("engineVersion"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SessionRequest {
    pub protocol_version: ProtocolVersion,
    pub ir_schema_version: u16,
    pub pairing_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobCreate {
    pub document_name: String,
    pub capability_id: String,
    pub input_kind: InputKind,
    pub declared_bytes: u64,
    pub page_count: u32,
    pub metadata: serde_json::Value,
    pub idempotency_key: Uuid,
}

impl JobCreate {
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.document_name.len() > 255 {
            return Err(ContractError::Limit("documentName"));
        }
        if self.capability_id.is_empty() || self.capability_id.len() > 96 {
            return Err(ContractError::Limit("capabilityId"));
        }
        if self.declared_bytes > MAX_DOCUMENT_BYTES {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InputChunk {
    pub chunk_sequence: u64,
    pub declared_length: u32,
}

impl InputChunk {
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.declared_length as usize > MAX_CHUNK_BYTES {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InputComplete {
    pub sha256_hex: String,
    pub total_bytes: u64,
}

impl InputComplete {
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.total_bytes > MAX_DOCUMENT_BYTES || self.sha256_hex.len() != 64 {
            return Err(ContractError::Code(ErrorCode::DigestMismatch));
        }
        if !self.sha256_hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ContractError::Code(ErrorCode::DigestMismatch));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Capability {
    pub id: String,
    pub version: String,
    pub provider_kind: ProviderKind,
    pub input_schema: String,
    pub output_schema: String,
    pub execution_locations: Vec<String>,
    pub deterministic: bool,
    pub requires_model: bool,
    pub confidence_calibrated: bool,
    pub privacy_class: String,
    pub diagnostic_only: bool,
    pub ir_schema_version: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProviderSource {
    pub page: u32,
    pub bbox: Vec<f32>,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProviderObservation {
    #[serde(rename = "type")]
    pub observation_type: String,
    pub value: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProviderMetadata {
    pub id: String,
    pub kind: ProviderKind,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ModelMetadata {
    pub id: String,
    pub revision: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProviderResult {
    pub schema: String,
    pub capability: String,
    pub source: ProviderSource,
    pub observations: Vec<ProviderObservation>,
    pub provider: ProviderMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelMetadata>,
    pub warnings: Vec<String>,
    pub diagnostics: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub completed_pages: u32,
    pub total_pages: u32,
    pub bytes_received: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negotiates_minor_versions_and_rejects_major_versions() {
        assert_eq!(
            ProtocolVersion::CURRENT
                .negotiate(ProtocolVersion { major: 1, minor: 9 })
                .unwrap()
                .minor,
            PROTOCOL_MINOR
        );
        assert!(matches!(
            ProtocolVersion::CURRENT.negotiate(ProtocolVersion { major: 2, minor: 0 }),
            Err(ContractError::IncompatibleProtocol { .. })
        ));
    }

    #[test]
    fn rejects_oversized_job_declarations() {
        let job = JobCreate {
            document_name: "x.pdf".into(),
            capability_id: "glyphmend.diagnostic.mock.v1".into(),
            input_kind: InputKind::Document,
            declared_bytes: MAX_DOCUMENT_BYTES + 1,
            page_count: 1,
            metadata: serde_json::json!({}),
            idempotency_key: Uuid::new_v4(),
        };
        assert_eq!(
            job.validate(),
            Err(ContractError::Code(ErrorCode::PayloadTooLarge))
        );
    }

    #[test]
    fn validates_provider_results_without_requiring_model_metadata() {
        let result = ProviderResult {
            schema: PROVIDER_RESULT_SCHEMA.into(),
            capability: "glyphmend.visual.classify.v1".into(),
            source: ProviderSource {
                page: 1,
                bbox: vec![0.0, 0.0, 1.0, 1.0],
                content_hash: "sha256:test".into(),
            },
            observations: vec![],
            provider: ProviderMetadata {
                id: "local".into(),
                kind: ProviderKind::HybridLocal,
                version: "1".into(),
            },
            model: None,
            warnings: vec![],
            diagnostics: serde_json::json!({}),
        };
        assert!(serde_json::to_value(result).unwrap().get("model").is_none());
    }
}
