//! Ollama Emulation API handlers.
//!
//! This module provides Ollama-compatible API endpoints, allowing EdgeQuake
//! to act as a drop-in replacement for Ollama. This enables integration with
//! tools like OpenWebUI that expect Ollama's API format.
//!
//! | Sub-module   | Responsibility                          | Spec         |
//! |-------------|-----------------------------------------|--------------|
//! | `admin`     | Version, tags, ps (model info)          | FEAT0600-0601 |
//! | `chat`      | Chat completion with RAG + streaming    | FEAT0602     |
//! | `generate`  | Text generation + streaming             | FEAT0603     |
//! | `helpers`   | Constants and utility functions          | —            |
//!
//! ## Use Cases
//!
//! - **UC2200**: User connects OpenWebUI to EdgeQuake as Ollama backend
//! - **UC2201**: User lists available models via Ollama-compatible API
//! - **UC2202**: User sends chat completion with query mode prefix
//! - **UC2203**: User generates text with streaming response
//!
//! ## Enforces
//!
//! - **BR0600**: API responses must match Ollama's JSON schema
//! - **BR0601**: Query mode prefixes must be stripped from user messages
//! - **BR0602**: Streaming format must be newline-delimited JSON

mod admin;
mod chat;
mod generate;
mod helpers;

pub use admin::*;
pub use chat::*;
pub use generate::*;

// Re-export DTOs for backward compatibility
pub use crate::handlers::ollama_types::{
    ollama_default_stream, OllamaChatRequest, OllamaChatResponse, OllamaGenerateRequest,
    OllamaGenerateResponse, OllamaMessage, OllamaModel, OllamaModelDetails, OllamaPsResponse,
    OllamaRunningModel, OllamaSearchMode, OllamaTagsResponse, OllamaVersionResponse,
};

#[cfg(test)]
mod tests {
    use super::helpers::*;
    use super::OllamaSearchMode;

    #[test]
    fn test_search_mode_parsing() {
        // Default mode
        let (query, mode, context_only) = OllamaSearchMode::from_query("hello world");
        assert_eq!(query, "hello world");
        assert_eq!(mode, OllamaSearchMode::Hybrid);
        assert!(!context_only);

        // Local mode
        let (query, mode, context_only) = OllamaSearchMode::from_query("/local what is rust?");
        assert_eq!(query, "what is rust?");
        assert_eq!(mode, OllamaSearchMode::Local);
        assert!(!context_only);

        // Global mode
        let (query, mode, context_only) = OllamaSearchMode::from_query("/global explain AI");
        assert_eq!(query, "explain AI");
        assert_eq!(mode, OllamaSearchMode::Global);
        assert!(!context_only);

        // Context only mode
        let (query, mode, context_only) = OllamaSearchMode::from_query("/localcontext entities");
        assert_eq!(query, "entities");
        assert_eq!(mode, OllamaSearchMode::Local);
        assert!(context_only);

        // Bypass mode
        let (query, mode, context_only) = OllamaSearchMode::from_query("/bypass just chat");
        assert_eq!(query, "just chat");
        assert_eq!(mode, OllamaSearchMode::Bypass);
        assert!(!context_only);
    }

    #[test]
    fn test_estimate_tokens() {
        assert_eq!(estimate_tokens("hello"), 1);
        assert_eq!(estimate_tokens("hello world"), 2);
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn test_model_name() {
        let name = model_name();
        assert!(name.contains("edgequake"));
    }

    #[test]
    fn test_ollama_constants() {
        assert_eq!(OLLAMA_MODEL_NAME, "edgequake");
        assert_eq!(OLLAMA_MODEL_TAG, "latest");
        assert_eq!(OLLAMA_API_VERSION, "0.9.3");
    }

    #[test]
    fn test_search_mode_naive() {
        let (query, mode, _) = OllamaSearchMode::from_query("/naive simple search");
        assert_eq!(query, "simple search");
        assert_eq!(mode, OllamaSearchMode::Naive);
    }

    #[test]
    fn test_search_mode_mix() {
        let (query, mode, _) = OllamaSearchMode::from_query("/mix combined");
        assert_eq!(query, "combined");
        assert_eq!(mode, OllamaSearchMode::Mix);
    }
}
