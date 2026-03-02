//! Response DTOs for the conversations API.
//!
//! Contains all response types with their From implementations
//! for converting domain models to API responses.

use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

/// Conversation response DTO.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConversationResponse {
    /// Conversation ID.
    pub id: Uuid,
    /// Tenant ID.
    pub tenant_id: Uuid,
    /// Workspace ID.
    pub workspace_id: Option<Uuid>,
    /// Title.
    pub title: String,
    /// Query mode.
    pub mode: String,
    /// Pinned state.
    pub is_pinned: bool,
    /// Archived state.
    pub is_archived: bool,
    /// Folder ID.
    pub folder_id: Option<Uuid>,
    /// Share ID (if shared).
    pub share_id: Option<String>,
    /// Message count.
    pub message_count: Option<usize>,
    /// Preview of last message.
    pub last_message_preview: Option<String>,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}

impl From<edgequake_core::Conversation> for ConversationResponse {
    fn from(c: edgequake_core::Conversation) -> Self {
        Self {
            id: c.conversation_id,
            tenant_id: c.tenant_id,
            workspace_id: c.workspace_id,
            title: c.title,
            mode: c.mode.to_string(),
            is_pinned: c.is_pinned,
            is_archived: c.is_archived,
            folder_id: c.folder_id,
            share_id: c.share_id,
            message_count: c.message_count,
            last_message_preview: c.last_message_preview,
            created_at: c.created_at.to_rfc3339(),
            updated_at: c.updated_at.to_rfc3339(),
        }
    }
}

/// Message response DTO.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessageResponse {
    /// Message ID.
    pub id: Uuid,
    /// Conversation ID.
    pub conversation_id: Uuid,
    /// Parent message ID.
    pub parent_id: Option<Uuid>,
    /// Role (user, assistant, system).
    pub role: String,
    /// Content.
    pub content: String,
    /// Query mode used.
    pub mode: Option<String>,
    /// Tokens used.
    pub tokens_used: Option<i32>,
    /// Duration in ms.
    pub duration_ms: Option<i32>,
    /// Thinking time in ms.
    pub thinking_time_ms: Option<i32>,
    /// Context (sources, entities).
    pub context: Option<serde_json::Value>,
    /// Error state.
    pub is_error: bool,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}

impl From<edgequake_core::Message> for MessageResponse {
    fn from(m: edgequake_core::Message) -> Self {
        Self {
            id: m.message_id,
            conversation_id: m.conversation_id,
            parent_id: m.parent_id,
            role: m.role.to_string(),
            content: m.content,
            mode: m.mode.map(|m| m.to_string()),
            tokens_used: m.tokens_used,
            duration_ms: m.duration_ms,
            thinking_time_ms: m.thinking_time_ms,
            context: m
                .context
                .map(|c| serde_json::to_value(c).unwrap_or_default()),
            is_error: m.is_error,
            created_at: m.created_at.to_rfc3339(),
            updated_at: m.updated_at.to_rfc3339(),
        }
    }
}

/// Folder response DTO.
#[derive(Debug, Serialize, ToSchema)]
pub struct FolderResponse {
    /// Folder ID.
    pub id: Uuid,
    /// Tenant ID.
    pub tenant_id: Uuid,
    /// Workspace ID.
    pub workspace_id: Option<Uuid>,
    /// Name.
    pub name: String,
    /// Parent folder ID.
    pub parent_id: Option<Uuid>,
    /// Position.
    pub position: i32,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}

impl From<edgequake_core::Folder> for FolderResponse {
    fn from(f: edgequake_core::Folder) -> Self {
        Self {
            id: f.folder_id,
            tenant_id: f.tenant_id,
            workspace_id: f.workspace_id,
            name: f.name,
            parent_id: f.parent_id,
            position: f.position,
            created_at: f.created_at.to_rfc3339(),
            updated_at: f.updated_at.to_rfc3339(),
        }
    }
}

/// Paginated conversations response.
#[derive(Debug, Serialize, ToSchema)]
pub struct PaginatedConversationsResponse {
    /// Conversation items.
    pub items: Vec<ConversationResponse>,
    /// Pagination metadata.
    pub pagination: PaginationMetaResponse,
}

/// Paginated messages response.
#[derive(Debug, Serialize, ToSchema)]
pub struct PaginatedMessagesResponse {
    /// Message items.
    pub items: Vec<MessageResponse>,
    /// Pagination metadata.
    pub pagination: PaginationMetaResponse,
}

/// Pagination metadata response.
#[derive(Debug, Serialize, ToSchema)]
pub struct PaginationMetaResponse {
    /// Cursor for next page.
    pub next_cursor: Option<String>,
    /// Cursor for previous page.
    pub prev_cursor: Option<String>,
    /// Total count (optional).
    pub total: Option<usize>,
    /// Whether more items exist.
    pub has_more: bool,
}

/// Conversation with messages response.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConversationWithMessagesResponse {
    /// Conversation details.
    pub conversation: ConversationResponse,
    /// Messages in the conversation.
    pub messages: Vec<MessageResponse>,
}

/// Share response.
#[derive(Debug, Serialize, ToSchema)]
pub struct ShareResponse {
    /// Share ID.
    pub share_id: String,
    /// Share URL.
    pub share_url: String,
}
