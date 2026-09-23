//! Pure job lifecycle and provider boundary.
#![forbid(unsafe_code)]

use companion_contract::{
    Capability, ContractError, ErrorCode, InputKind, Progress, ProviderKind, ProviderMetadata,
    ProviderObservation, ProviderResult, ProviderSource, PROVIDER_RESULT_SCHEMA,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Created,
    Receiving,
    Queued,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Failed,
}

impl JobState {
    pub fn transition(self, next: Self) -> Result<Self, CoreError> {
        use JobState::*;
        let valid = matches!(
            (self, next),
            (Created, Receiving)
                | (Receiving, Queued)
                | (Queued, Running)
                | (Running, Cancelling)
                | (Cancelling, Cancelled)
                | (Running, Completed)
                | (Created, Cancelled)
                | (Receiving, Cancelled)
                | (Queued, Cancelled)
                | (Created, Failed)
                | (Receiving, Failed)
                | (Queued, Failed)
                | (Running, Failed)
        );
        valid.then_some(next).ok_or(CoreError::InvalidTransition {
            from: self,
            to: next,
        })
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CoreError {
    #[error("invalid job state transition: {from:?} -> {to:?}")]
    InvalidTransition { from: JobState, to: JobState },
    #[error("provider failed: {0}")]
    Provider(String),
    #[error("{0}")]
    Contract(#[from] ContractError),
}

#[derive(Debug, Clone)]
pub struct ProviderInput {
    pub job_id: Uuid,
    pub input_kind: InputKind,
    pub capability_id: String,
    pub page_count: u32,
    pub bytes_received: u64,
    pub content_hash: String,
    pub input_path: PathBuf,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct ProviderOutput {
    pub progress: Vec<Progress>,
    pub result: Option<ProviderResult>,
}

pub trait CapabilityProvider: Send + Sync {
    fn capability(&self) -> Capability;
    fn run(
        &self,
        input: ProviderInput,
        cancellation: CancellationToken,
    ) -> Result<ProviderOutput, CoreError>;
}

#[derive(Debug, Default)]
pub struct DiagnosticMockProvider;

impl CapabilityProvider for DiagnosticMockProvider {
    fn capability(&self) -> Capability {
        Capability {
            id: "glyphmend.diagnostic.mock.v1".into(),
            version: "1.0.0".into(),
            provider_kind: ProviderKind::Deterministic,
            input_schema: "glyphmend.job-input.v1".into(),
            output_schema: PROVIDER_RESULT_SCHEMA.into(),
            execution_locations: vec!["companion".into(), "tauri".into()],
            deterministic: true,
            requires_model: false,
            confidence_calibrated: true,
            privacy_class: "local-only".into(),
            diagnostic_only: true,
            ir_schema_version: companion_contract::IR_SCHEMA_VERSION,
        }
    }

    fn run(
        &self,
        input: ProviderInput,
        cancellation: CancellationToken,
    ) -> Result<ProviderOutput, CoreError> {
        if cancellation.is_cancelled() {
            return Err(CoreError::Contract(ContractError::Code(
                ErrorCode::Cancelled,
            )));
        }
        let pages = input.page_count.max(1);
        let progress = (1..=pages)
            .map(|page| Progress {
                phase: "diagnostic-mock".into(),
                completed_pages: page,
                total_pages: pages,
                bytes_received: input.bytes_received,
            })
            .collect();
        let result = ProviderResult {
            schema: PROVIDER_RESULT_SCHEMA.into(),
            capability: input.capability_id,
            source: ProviderSource {
                page: 1,
                bbox: vec![0.0, 0.0, 1.0, 1.0],
                content_hash: input.content_hash,
            },
            observations: vec![ProviderObservation {
                observation_type: "diagnostic".into(),
                value: serde_json::json!({
                    "jobId": input.job_id,
                    "inputKind": input.input_kind,
                    "bytes": input.bytes_received,
                }),
                confidence: Some(1.0),
            }],
            provider: ProviderMetadata {
                id: "glyphmend.diagnostic.mock".into(),
                kind: ProviderKind::Deterministic,
                version: "1.0.0".into(),
            },
            model: None,
            warnings: vec!["Diagnostic provider output is not canonical document evidence.".into()],
            diagnostics: serde_json::json!({ "metadata": input.metadata }),
        };
        Ok(ProviderOutput {
            progress,
            result: Some(result),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ProviderInput {
        ProviderInput {
            job_id: Uuid::new_v4(),
            input_kind: InputKind::Document,
            capability_id: "glyphmend.diagnostic.mock.v1".into(),
            page_count: 2,
            bytes_received: 3,
            content_hash: "a".repeat(64),
            input_path: PathBuf::from("fixture.pdf"),
            metadata: serde_json::json!({}),
        }
    }

    #[test]
    fn state_machine_fails_closed() {
        assert_eq!(
            JobState::Created.transition(JobState::Receiving),
            Ok(JobState::Receiving)
        );
        assert!(JobState::Completed.transition(JobState::Running).is_err());
    }

    #[test]
    fn mock_is_diagnostic_only_and_returns_provider_evidence() {
        let provider = DiagnosticMockProvider;
        assert!(provider.capability().diagnostic_only);
        let output = provider.run(input(), CancellationToken::new()).unwrap();
        assert_eq!(output.progress.len(), 2);
        let result = output.result.unwrap();
        assert_eq!(result.provider.kind, ProviderKind::Deterministic);
        assert!(result.validate().is_ok());
    }
}
