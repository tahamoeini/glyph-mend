//! Versioned, transport-neutral companion wire contract.
#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const PROTOCOL_MAJOR: u16 = 1;
pub const PROTOCOL_MINOR: u16 = 0;
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const IR_SCHEMA_ID: &str = "glyphmend.semantic-document-ir";
pub const IR_SCHEMA_VERSION: u16 = 2;
pub const MAX_CONTROL_BYTES: usize = 64 * 1024;
pub const MAX_CHUNK_BYTES: usize = 1024 * 1024;
pub const MAX_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_EVENT_QUEUE: usize = 128;
pub const MAX_CONCURRENT_JOBS: usize = 2;
pub const CONTROL_TIMEOUT_SECS: u64 = 30;
pub const SESSION_IDLE_SECS: u64 = 15 * 60;
pub const PAIRING_TTL_SECS: u64 = 5 * 60;
pub const CHECKPOINT_TTL_SECS: u64 = 24 * 60 * 60;

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
    Cancelled,
    Internal,
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
pub struct Hello {
    pub origin: String,
    pub client_name: String,
    pub supported_protocol: ProtocolVersion,
    pub ir_schema_version: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Pair {
    pub pairing_code: String,
    pub origin: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobCreate {
    pub document_name: String,
    pub declared_bytes: u64,
    pub page_count: u32,
    pub requested_capabilities: Vec<String>,
    pub idempotency_key: Uuid,
}

impl JobCreate {
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.document_name.len() > 255 {
            return Err(ContractError::Limit("documentName"));
        }
        if self.declared_bytes > MAX_DOCUMENT_BYTES {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        if self.requested_capabilities.len() > 16 {
            return Err(ContractError::Limit("requestedCapabilities"));
        }
        if self
            .requested_capabilities
            .iter()
            .any(|capability| capability.len() > 96)
        {
            return Err(ContractError::Limit("requestedCapabilities"));
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Capability {
    pub id: String,
    pub diagnostic_only: bool,
    pub ir_schema_version: u16,
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
            0
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
            declared_bytes: MAX_DOCUMENT_BYTES + 1,
            page_count: 1,
            requested_capabilities: vec![],
            idempotency_key: Uuid::new_v4(),
        };
        assert_eq!(
            job.validate(),
            Err(ContractError::Code(ErrorCode::PayloadTooLarge))
        );
    }
}
