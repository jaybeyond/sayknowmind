//! Ollama admin/info endpoints (version, tags, ps).
//!
//! Lightweight read-only handlers that return model metadata.

use axum::Json;

use crate::handlers::ollama_types::{
    OllamaModel, OllamaModelDetails, OllamaPsResponse, OllamaRunningModel, OllamaTagsResponse,
    OllamaVersionResponse,
};

use super::helpers::*;

/// Get Ollama API version.
#[utoipa::path(
    get,
    path = "/api/version",
    tag = "Ollama Emulation",
    responses(
        (status = 200, description = "Version information", body = OllamaVersionResponse)
    )
)]
pub async fn ollama_version() -> Json<OllamaVersionResponse> {
    Json(OllamaVersionResponse {
        version: OLLAMA_API_VERSION.to_string(),
    })
}

/// List available models (Ollama tags endpoint).
#[utoipa::path(
    get,
    path = "/api/tags",
    tag = "Ollama Emulation",
    responses(
        (status = 200, description = "List of available models", body = OllamaTagsResponse)
    )
)]
pub async fn ollama_tags() -> Json<OllamaTagsResponse> {
    let model = OllamaModel {
        name: model_name(),
        model: model_name(),
        size: OLLAMA_MODEL_SIZE,
        digest: OLLAMA_MODEL_DIGEST.to_string(),
        modified_at: current_timestamp(),
        details: OllamaModelDetails {
            parent_model: String::new(),
            format: "gguf".to_string(),
            family: OLLAMA_MODEL_NAME.to_string(),
            families: vec![OLLAMA_MODEL_NAME.to_string()],
            parameter_size: "7B".to_string(),
            quantization_level: "Q4_0".to_string(),
        },
    };

    Json(OllamaTagsResponse {
        models: vec![model],
    })
}

/// List running models (Ollama ps endpoint).
#[utoipa::path(
    get,
    path = "/api/ps",
    tag = "Ollama Emulation",
    responses(
        (status = 200, description = "List of running models", body = OllamaPsResponse)
    )
)]
pub async fn ollama_ps() -> Json<OllamaPsResponse> {
    let model = OllamaRunningModel {
        name: model_name(),
        model: model_name(),
        size: OLLAMA_MODEL_SIZE,
        digest: OLLAMA_MODEL_DIGEST.to_string(),
        details: OllamaModelDetails {
            parent_model: String::new(),
            format: "gguf".to_string(),
            family: "llama".to_string(),
            families: vec!["llama".to_string()],
            parameter_size: "7B".to_string(),
            quantization_level: "Q4_0".to_string(),
        },
        expires_at: "2050-12-31T23:59:59Z".to_string(),
        size_vram: OLLAMA_MODEL_SIZE,
    };

    Json(OllamaPsResponse {
        models: vec![model],
    })
}
