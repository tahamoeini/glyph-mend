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
pub const MAX_RUNTIME_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_SESSION_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_ACTIVE_JOBS: usize = 8;
pub const MAX_EVENT_QUEUE: usize = 128;
pub const MAX_CONCURRENT_JOBS: usize = 2;
pub const MAX_OBSERVATIONS: usize = 256;
pub const MAX_WARNINGS: usize = 64;
pub const MAX_METADATA_BYTES: usize = 16 * 1024;
pub const MAX_DIAGNOSTICS_BYTES: usize = 32 * 1024;
pub const MAX_PROVIDER_RESULT_BYTES: usize = 64 * 1024;
pub const MAX_IDENTIFIER_BYTES: usize = 128;
pub const CONTROL_TIMEOUT_SECS: u64 = 30;
pub const SESSION_IDLE_SECS: u64 = 15 * 60;
pub const PAIRING_TTL_SECS: u64 = 5 * 60;
pub const ABANDONED_JOB_TTL_SECS: u64 = 30 * 60;
pub const PROVIDER_TIMEOUT_SECS: u64 = 5 * 60;
pub const JOB_RETENTION_SECS: u64 = 24 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    ProtocolIncompatible,
    IrSchemaUnsupported,
    CapabilityUnsupported,
    InvalidRequest,
    InvalidState,
    InvalidSequence,
    PayloadTooLarge,
    DigestMismatch,
    PairingRequired,
    SecurityRejected,
    SessionExpired,
    EventHistoryGap,
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
    #[error("event history starts at sequence {earliest_sequence}")]
    EventHistoryGap { earliest_sequence: u64 },
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
pub struct SessionRequest {
    pub protocol_version: ProtocolVersion,
    pub ir_schema_version: u16,
    pub pairing_code: String,
}

impl SessionRequest {
    pub fn validate(&self) -> Result<ProtocolVersion, ContractError> {
        if self.pairing_code.is_empty() || self.pairing_code.len() > MAX_IDENTIFIER_BYTES {
            return Err(ContractError::Code(ErrorCode::PairingRequired));
        }
        ProtocolVersion::CURRENT.negotiate(self.protocol_version)
    }
}

pub const REGION_INPUT_SCHEMA: &str = "glyphmend.region-input.v1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RegionInputMetadata {
    pub schema: String,
    pub page: u32,
    pub bbox: [f64; 4],
    pub source_ids: Vec<String>,
    pub deterministic_summary: serde_json::Value,
}

impl RegionInputMetadata {
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.schema != REGION_INPUT_SCHEMA
            || self.page == 0
            || !self.deterministic_summary.is_object()
        {
            return Err(ContractError::Code(ErrorCode::InvalidRequest));
        }
        if self.bbox.iter().any(|coordinate| !coordinate.is_finite()) {
            return Err(ContractError::Code(ErrorCode::InvalidRequest));
        }
        if self.source_ids.len() > MAX_OBSERVATIONS
            || self
                .source_ids
                .iter()
                .any(|source_id| source_id.is_empty() || source_id.len() > MAX_IDENTIFIER_BYTES)
        {
            return Err(ContractError::Limit("sourceIds"));
        }
        Ok(())
    }
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
        if self.capability_id.is_empty() || self.capability_id.len() > MAX_IDENTIFIER_BYTES {
            return Err(ContractError::Limit("capabilityId"));
        }
        if self.declared_bytes > MAX_DOCUMENT_BYTES {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        if !self.metadata.is_object() {
            return Err(ContractError::Code(ErrorCode::InvalidRequest));
        }
        let metadata = serde_json::to_vec(&self.metadata)
            .map_err(|_| ContractError::Code(ErrorCode::InvalidRequest))?;
        if metadata.len() > MAX_METADATA_BYTES {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        if serde_json::to_vec(self)
            .map_err(|_| ContractError::Code(ErrorCode::InvalidRequest))?
            .len()
            > MAX_CONTROL_BYTES
        {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        if self.input_kind == InputKind::Region {
            let region: RegionInputMetadata = serde_json::from_value(self.metadata.clone())
                .map_err(|_| ContractError::Code(ErrorCode::InvalidRequest))?;
            region.validate()?;
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

impl Capability {
    pub fn validate(&self) -> Result<(), ContractError> {
        let identifiers = [
            self.id.as_str(),
            self.version.as_str(),
            self.input_schema.as_str(),
            self.output_schema.as_str(),
            self.privacy_class.as_str(),
        ];
        if identifiers.iter().any(|value| value.is_empty()) {
            return Err(ContractError::Code(ErrorCode::InvalidRequest));
        }
        if identifiers
            .iter()
            .any(|value| value.len() > MAX_IDENTIFIER_BYTES)
            || self.execution_locations.len() > 16
            || self
                .execution_locations
                .iter()
                .any(|location| location.is_empty() || location.len() > MAX_IDENTIFIER_BYTES)
        {
            return Err(ContractError::Limit("capability"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProviderSource {
    pub page: u32,
    pub bbox: Vec<f64>,
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

impl ProviderResult {
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.schema != PROVIDER_RESULT_SCHEMA
            || self.capability.is_empty()
            || self.capability.len() > MAX_IDENTIFIER_BYTES
            || self.provider.id.is_empty()
            || self.provider.id.len() > MAX_IDENTIFIER_BYTES
            || self.provider.version.is_empty()
            || self.provider.version.len() > MAX_IDENTIFIER_BYTES
            || self.source.page == 0
            || self.source.bbox.len() != 4
            || self
                .source
                .bbox
                .iter()
                .any(|coordinate| !coordinate.is_finite())
            || !is_sha256_hex(&self.source.content_hash)
            || self.observations.len() > MAX_OBSERVATIONS
            || self.warnings.len() > MAX_WARNINGS
        {
            return Err(ContractError::Code(ErrorCode::InvalidRequest));
        }
        if self.observations.iter().any(|observation| {
            observation.observation_type.is_empty()
                || observation.observation_type.len() > MAX_IDENTIFIER_BYTES
                || observation
                    .confidence
                    .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        }) {
            return Err(ContractError::Code(ErrorCode::InvalidRequest));
        }
        if self.warnings.iter().any(|warning| warning.len() > 512) {
            return Err(ContractError::Limit("warnings"));
        }
        if let Some(model) = &self.model {
            if model.id.is_empty()
                || model.id.len() > MAX_IDENTIFIER_BYTES
                || model.revision.is_empty()
                || model.revision.len() > MAX_IDENTIFIER_BYTES
                || !is_sha256_hex(&model.sha256)
            {
                return Err(ContractError::Code(ErrorCode::InvalidRequest));
            }
        }
        if !self.diagnostics.is_object() {
            return Err(ContractError::Code(ErrorCode::InvalidRequest));
        }
        let diagnostics = serde_json::to_vec(&self.diagnostics)
            .map_err(|_| ContractError::Code(ErrorCode::InvalidRequest))?;
        if diagnostics.len() > MAX_DIAGNOSTICS_BYTES {
            return Err(ContractError::Limit("diagnostics"));
        }
        let serialized =
            serde_json::to_vec(self).map_err(|_| ContractError::Code(ErrorCode::InvalidRequest))?;
        if serialized.len() > MAX_PROVIDER_RESULT_BYTES {
            return Err(ContractError::Code(ErrorCode::PayloadTooLarge));
        }
        Ok(())
    }
}

pub fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
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
    fn rejects_invalid_region_metadata_and_provider_result_limits() {
        let invalid_region = serde_json::json!({
            "schema": REGION_INPUT_SCHEMA, "page": 1, "bbox": [0.0, 0.0, 1.0],
            "sourceIds": [], "deterministicSummary": {}
        });
        assert!(serde_json::from_value::<RegionInputMetadata>(invalid_region).is_err());
        let region = RegionInputMetadata {
            schema: REGION_INPUT_SCHEMA.into(),
            page: 1,
            bbox: [0.0, 0.0, f64::INFINITY, 1.0],
            source_ids: Vec::new(),
            deterministic_summary: serde_json::json!({}),
        };
        assert!(region.validate().is_err());

        let mut result = valid_result();
        result.source.bbox.push(2.0);
        assert!(result.validate().is_err());
        let mut result = valid_result();
        result.source.content_hash = "not-a-digest".into();
        assert!(result.validate().is_err());
        let mut result = valid_result();
        result.observations.push(ProviderObservation {
            observation_type: "test".into(),
            value: serde_json::json!(null),
            confidence: Some(1.1),
        });
        assert!(result.validate().is_err());
        let mut result = valid_result();
        result.observations = (0..=MAX_OBSERVATIONS)
            .map(|_| ProviderObservation {
                observation_type: "test".into(),
                value: serde_json::json!(null),
                confidence: None,
            })
            .collect();
        assert!(result.validate().is_err());
        let mut result = valid_result();
        result.warnings = vec!["warning".into(); MAX_WARNINGS + 1];
        assert!(result.validate().is_err());
        let mut result = valid_result();
        result.diagnostics = serde_json::json!({ "large": "x".repeat(MAX_DIAGNOSTICS_BYTES) });
        assert!(result.validate().is_err());
        let mut result = valid_result();
        result.observations.push(ProviderObservation {
            observation_type: "large".into(),
            value: serde_json::json!("x".repeat(MAX_PROVIDER_RESULT_BYTES)),
            confidence: None,
        });
        assert_eq!(
            result.validate(),
            Err(ContractError::Code(ErrorCode::PayloadTooLarge))
        );
    }

    fn valid_result() -> ProviderResult {
        ProviderResult {
            schema: PROVIDER_RESULT_SCHEMA.into(),
            capability: "glyphmend.diagnostic.mock.v1".into(),
            source: ProviderSource {
                page: 1,
                bbox: vec![0.0, 0.0, 1.0, 1.0],
                content_hash: "a".repeat(64),
            },
            observations: Vec::new(),
            provider: ProviderMetadata {
                id: "diagnostic".into(),
                kind: ProviderKind::Deterministic,
                version: "1".into(),
            },
            model: None,
            warnings: Vec::new(),
            diagnostics: serde_json::json!({}),
        }
    }

    #[test]
    fn validates_provider_results_without_requiring_model_metadata() {
        let result = ProviderResult {
            schema: PROVIDER_RESULT_SCHEMA.into(),
            capability: "glyphmend.visual.classify.v1".into(),
            source: ProviderSource {
                page: 1,
                bbox: vec![0.0, 0.0, 1.0, 1.0],
                content_hash: "a".repeat(64),
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
        assert!(result.validate().is_ok());
        assert!(serde_json::to_value(result).unwrap().get("model").is_none());
    }
}
