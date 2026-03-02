//! Task failure information types.
//!
//! Structured error information for failed tasks, including
//! factory methods for common failure categories and circuit
//! breaker timeout detection.

use serde::{Deserialize, Serialize};

/// Detailed error information for failed tasks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFailureInfo {
    /// Human-readable error message.
    pub message: String,
    /// Processing step where the error occurred.
    pub step: String,
    /// Technical reason for the error.
    pub reason: String,
    /// Suggested action to resolve the error.
    pub suggestion: String,
    /// Whether this error is retryable.
    pub retryable: bool,
}

impl TaskFailureInfo {
    /// Create a new task error.
    pub fn new(
        message: impl Into<String>,
        step: impl Into<String>,
        reason: impl Into<String>,
        suggestion: impl Into<String>,
        retryable: bool,
    ) -> Self {
        Self {
            message: message.into(),
            step: step.into(),
            reason: reason.into(),
            suggestion: suggestion.into(),
            retryable,
        }
    }

    /// Create a chunking error.
    pub fn chunking(reason: impl Into<String>) -> Self {
        Self::new(
            "Document chunking failed",
            "chunking",
            reason,
            "Check document format and encoding",
            true,
        )
    }

    /// Create a timeout error (LLM or embedding).
    ///
    /// @implements CIRCUIT_BREAKER: Timeout classification
    ///
    /// WHY: Timeouts need special handling via circuit breaker pattern.
    /// Consecutive timeouts indicate structural problem (doc too large,
    /// LLM overloaded) that won't resolve by retrying.
    pub fn timeout(step: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::new(
            "Operation timed out",
            step,
            reason,
            "Document may be too large. Try: 1) Use smaller chunk size, 2) Split document, 3) Use provider with longer timeout",
            false, // Not retryable after circuit breaker trips
        )
    }

    /// Check if this error represents a timeout.
    ///
    /// @implements CIRCUIT_BREAKER: Timeout detection
    pub fn is_timeout(&self) -> bool {
        self.message.to_lowercase().contains("timeout")
            || self.reason.to_lowercase().contains("timeout")
            || self.reason.to_lowercase().contains("timed out")
    }

    /// Create an embedding error.
    pub fn embedding(reason: impl Into<String>) -> Self {
        Self::new(
            "Embedding generation failed",
            "embedding",
            reason,
            "Check LLM provider connectivity and API limits",
            true,
        )
    }

    /// Create an extraction error.
    pub fn extraction(reason: impl Into<String>) -> Self {
        Self::new(
            "Entity extraction failed",
            "extraction",
            reason,
            "Check LLM provider connectivity and API limits",
            true,
        )
    }

    /// Create an indexing error.
    pub fn indexing(reason: impl Into<String>) -> Self {
        Self::new(
            "Graph indexing failed",
            "indexing",
            reason,
            "Check storage backend connectivity",
            true,
        )
    }

    /// Create a rate limit error.
    pub fn rate_limit(step: impl Into<String>) -> Self {
        Self::new(
            "Rate limit exceeded",
            step,
            "API rate limit exceeded",
            "Wait 30 seconds and retry, or reduce batch size",
            true,
        )
    }
}
