//! Request DTOs for the conversations API.
//!
//! Contains request types for CRUD operations, bulk operations,
//! and import/export functionality.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::helpers::{conversations_default_stream, deserialize_nullable};

// ============================================================================
// CRUD Request DTOs
// ============================================================================

/// Create conversation request DTO.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateConversationApiRequest {
    /// Optional title.
    pub title: Option<String>,
    /// Query mode.
    pub mode: Option<String>,
    /// Folder ID.
    pub folder_id: Option<Uuid>,
}

/// Update conversation request DTO.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateConversationApiRequest {
    /// New title.
    pub title: Option<String>,
    /// New mode.
    pub mode: Option<String>,
    /// Pinned state.
    pub is_pinned: Option<bool>,
    /// Archived state.
    pub is_archived: Option<bool>,
    /// Folder ID - supports explicit null to remove from folder.
    /// - Absent in JSON: don't update (None)
    /// - `null` in JSON: remove from folder (Some(None))
    /// - UUID in JSON: move to folder (Some(Some(uuid)))
    #[serde(default, deserialize_with = "deserialize_nullable")]
    #[schema(value_type = Option<Uuid>)]
    pub folder_id: Option<Option<Uuid>>,
}

/// Create message request DTO.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateMessageApiRequest {
    /// Message content.
    pub content: String,
    /// Role (user, assistant, system).
    pub role: String,
    /// Parent message ID.
    pub parent_id: Option<Uuid>,
    /// Whether to stream response.
    #[serde(default = "conversations_default_stream")]
    pub stream: bool,
}

/// Update message request DTO.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateMessageApiRequest {
    /// New content.
    pub content: Option<String>,
    /// Tokens used.
    pub tokens_used: Option<i32>,
    /// Duration in ms.
    pub duration_ms: Option<i32>,
    /// Thinking time in ms.
    pub thinking_time_ms: Option<i32>,
    /// Context.
    pub context: Option<serde_json::Value>,
    /// Error state.
    pub is_error: Option<bool>,
}

/// Create folder request DTO.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateFolderApiRequest {
    /// Folder name.
    pub name: String,
    /// Parent folder ID.
    pub parent_id: Option<Uuid>,
}

/// Update folder request DTO.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateFolderApiRequest {
    /// New name.
    pub name: Option<String>,
    /// New parent.
    pub parent_id: Option<Uuid>,
    /// New position.
    pub position: Option<i32>,
}

// ============================================================================
// Bulk Operation DTOs
// ============================================================================

/// Bulk operation request.
#[derive(Debug, Deserialize, ToSchema)]
pub struct BulkOperationRequest {
    /// Conversation IDs.
    pub conversation_ids: Vec<Uuid>,
}

/// Bulk archive request.
#[derive(Debug, Deserialize, ToSchema)]
pub struct BulkArchiveRequest {
    /// Conversation IDs.
    pub conversation_ids: Vec<Uuid>,
    /// Archive state.
    pub archive: bool,
}

/// Bulk move request.
#[derive(Debug, Deserialize, ToSchema)]
pub struct BulkMoveRequest {
    /// Conversation IDs.
    pub conversation_ids: Vec<Uuid>,
    /// Target folder ID.
    pub folder_id: Option<Uuid>,
}

/// Bulk operation response.
#[derive(Debug, Serialize, ToSchema)]
pub struct BulkOperationResponse {
    /// Number of items affected.
    pub affected: usize,
}

// ============================================================================
// Import/Export DTOs
// ============================================================================

/// Import request.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ImportConversationsRequest {
    /// Conversations to import (from localStorage).
    pub conversations: Vec<serde_json::Value>,
}

/// Import response.
#[derive(Debug, Serialize, ToSchema)]
pub struct ImportConversationsResponse {
    /// Number imported.
    pub imported: usize,
    /// Number failed.
    pub failed: usize,
    /// Errors.
    pub errors: Vec<ImportErrorResponse>,
}

/// Import error.
#[derive(Debug, Serialize, ToSchema)]
pub struct ImportErrorResponse {
    /// Conversation ID.
    pub id: String,
    /// Error message.
    pub error: String,
}
