//! Configuration types for application state.
//!
//! Contains storage mode selection, application config, and shared service type aliases.

use std::sync::Arc;

use edgequake_core::{ConversationService, WorkspaceService};
use serde::{Deserialize, Serialize};

// ── Type Aliases ──────────────────────────────────────────────────────────

/// Type alias for the shared workspace service.
pub type SharedWorkspaceService = Arc<dyn WorkspaceService>;

/// Type alias for the shared conversation service.
pub type SharedConversationService = Arc<dyn ConversationService>;

// ── StorageMode ───────────────────────────────────────────────────────────

/// Storage mode indicator for the application.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StorageMode {
    /// In-memory storage (data lost on restart).
    Memory,
    /// PostgreSQL persistent storage.
    PostgreSQL,
}

impl StorageMode {
    /// Get the storage mode as a string.
    pub fn as_str(&self) -> &'static str {
        match self {
            StorageMode::Memory => "memory",
            StorageMode::PostgreSQL => "postgresql",
        }
    }

    /// Check if using PostgreSQL storage.
    pub fn is_postgresql(&self) -> bool {
        matches!(self, StorageMode::PostgreSQL)
    }

    /// Check if using in-memory storage.
    pub fn is_memory(&self) -> bool {
        matches!(self, StorageMode::Memory)
    }
}

// ── AppConfig ─────────────────────────────────────────────────────────────

/// Application configuration.
#[derive(Debug, Clone)]
pub struct AppConfig {
    /// Workspace/tenant ID.
    pub workspace_id: String,

    /// Maximum document size in bytes.
    /// SPEC-028: Updated to 50MB to support larger documents.
    pub max_document_size: usize,

    /// Maximum query length.
    pub max_query_length: usize,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            workspace_id: "default".to_string(),
            // SPEC-028: 50MB document upload limit (was 10MB)
            // WHY: Support larger documents like research papers and reports
            max_document_size: 50 * 1024 * 1024, // 50 MB
            max_query_length: 10000,
        }
    }
}
