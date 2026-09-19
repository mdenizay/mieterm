//! One error type for everything the frontend can trigger.
//!
//! Every variant carries a sentence a user can act on, because these strings are shown
//! verbatim in the UI. The optional detail holds the underlying message — ssh's stderr,
//! an OS error — which the UI puts behind a disclosure rather than in the headline.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        if !detail.trim().is_empty() {
            self.detail = Some(detail);
        }
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "{} ({detail})", self.message),
            None => f.write_str(&self.message),
        }
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

/// Turns any error into a generic failure with the cause kept as detail. Used for the
/// cases where the underlying error has no better sentence than its own text.
pub fn wrap<E: std::fmt::Display>(message: &str) -> impl Fn(E) -> AppError + '_ {
    move |e| AppError::new(message).with_detail(e.to_string())
}
