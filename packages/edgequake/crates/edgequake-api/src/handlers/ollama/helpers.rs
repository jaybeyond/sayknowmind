//! Shared constants and utility functions for Ollama emulation handlers.

use chrono::Utc;

/// Default model name for Ollama emulation.
pub(super) const OLLAMA_MODEL_NAME: &str = "edgequake";
/// Default model tag for Ollama emulation.
pub(super) const OLLAMA_MODEL_TAG: &str = "latest";
/// Default model size (placeholder).
pub(super) const OLLAMA_MODEL_SIZE: u64 = 7_000_000_000; // 7GB placeholder
/// Default model digest.
pub(super) const OLLAMA_MODEL_DIGEST: &str = "sha256:edgequake-rag-v1";
/// API version string.
pub(super) const OLLAMA_API_VERSION: &str = "0.9.3";

/// Estimate token count for a string (rough approximation: 1 token ≈ 4 chars).
pub(super) fn estimate_tokens(text: &str) -> u32 {
    (text.len() / 4) as u32
}

/// Get the current timestamp in ISO 8601 format.
pub(super) fn current_timestamp() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.6fZ").to_string()
}

/// Get the model name for responses.
pub(super) fn model_name() -> String {
    format!("{}:{}", OLLAMA_MODEL_NAME, OLLAMA_MODEL_TAG)
}
