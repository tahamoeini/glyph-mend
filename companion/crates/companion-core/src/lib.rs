//! Pure job lifecycle and future-provider boundary.
#![forbid(unsafe_code)]

use companion_contract::{Capability, ContractError, ErrorCode, Progress};
use thiserror::Error;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
    pub page_count: u32,
    pub bytes_received: u64,
}
#[derive(Debug, Clone)]
pub struct ProviderOutput {
    pub progress: Vec<Progress>,
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
        Ok(ProviderOutput { progress })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn state_machine_fails_closed() {
        assert_eq!(
            JobState::Created.transition(JobState::Receiving),
            Ok(JobState::Receiving)
        );
        assert!(JobState::Completed.transition(JobState::Running).is_err());
    }
    #[test]
    fn mock_is_diagnostic_only() {
        assert!(DiagnosticMockProvider.capability().diagnostic_only);
    }
}
