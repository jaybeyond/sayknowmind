//! Core domain models: Conversation, Message, and Folder.
//!
//! These structs represent the primary entities in the conversation system,
//! including builder-pattern constructors for ergonomic creation.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use super::context::MessageContext;
use super::enums::{ConversationMode, MessageRole};

/// A conversation (chat session).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    /// Unique identifier.
    pub conversation_id: Uuid,
    /// Tenant this conversation belongs to.
    pub tenant_id: Uuid,
    /// Optional workspace scope.
    pub workspace_id: Option<Uuid>,
    /// User who owns this conversation.
    pub user_id: Uuid,
    /// Conversation title.
    pub title: String,
    /// Default query mode.
    pub mode: ConversationMode,
    /// Whether this conversation is pinned.
    pub is_pinned: bool,
    /// Whether this conversation is archived.
    pub is_archived: bool,
    /// Optional folder for organization.
    pub folder_id: Option<Uuid>,
    /// Share ID for public access (if shared).
    pub share_id: Option<String>,
    /// Additional metadata.
    pub meta: HashMap<String, serde_json::Value>,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Last update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,

    // Computed fields (not stored in DB)
    /// Number of messages in the conversation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_count: Option<usize>,
    /// Preview of the last message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_preview: Option<String>,
}

impl Conversation {
    /// Create a new conversation.
    pub fn new(tenant_id: Uuid, user_id: Uuid) -> Self {
        let now = chrono::Utc::now();
        Self {
            conversation_id: Uuid::new_v4(),
            tenant_id,
            workspace_id: None,
            user_id,
            title: "New Conversation".to_string(),
            mode: ConversationMode::Hybrid,
            is_pinned: false,
            is_archived: false,
            folder_id: None,
            share_id: None,
            meta: HashMap::new(),
            created_at: now,
            updated_at: now,
            message_count: Some(0),
            last_message_preview: None,
        }
    }

    /// Set the conversation title.
    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = title.into();
        self
    }

    /// Set the query mode.
    pub fn with_mode(mut self, mode: ConversationMode) -> Self {
        self.mode = mode;
        self
    }

    /// Set the workspace.
    pub fn with_workspace(mut self, workspace_id: Uuid) -> Self {
        self.workspace_id = Some(workspace_id);
        self
    }

    /// Set the folder.
    pub fn with_folder(mut self, folder_id: Uuid) -> Self {
        self.folder_id = Some(folder_id);
        self
    }
}

/// A message within a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// Unique identifier.
    pub message_id: Uuid,
    /// Parent conversation.
    pub conversation_id: Uuid,
    /// Parent message (for threading).
    pub parent_id: Option<Uuid>,
    /// Message role.
    pub role: MessageRole,
    /// Message content.
    pub content: String,
    /// Query mode used for this message.
    pub mode: Option<ConversationMode>,
    /// Tokens used for this response.
    pub tokens_used: Option<i32>,
    /// Response generation time in milliseconds.
    pub duration_ms: Option<i32>,
    /// Thinking/reasoning time in milliseconds.
    pub thinking_time_ms: Option<i32>,
    /// Context attached to assistant responses.
    pub context: Option<MessageContext>,
    /// Whether this message represents an error.
    pub is_error: bool,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Last update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl Message {
    /// Create a new user message.
    pub fn user(conversation_id: Uuid, content: impl Into<String>) -> Self {
        let now = chrono::Utc::now();
        Self {
            message_id: Uuid::new_v4(),
            conversation_id,
            parent_id: None,
            role: MessageRole::User,
            content: content.into(),
            mode: None,
            tokens_used: None,
            duration_ms: None,
            thinking_time_ms: None,
            context: None,
            is_error: false,
            created_at: now,
            updated_at: now,
        }
    }

    /// Create a new assistant message.
    pub fn assistant(conversation_id: Uuid, content: impl Into<String>) -> Self {
        let now = chrono::Utc::now();
        Self {
            message_id: Uuid::new_v4(),
            conversation_id,
            parent_id: None,
            role: MessageRole::Assistant,
            content: content.into(),
            mode: None,
            tokens_used: None,
            duration_ms: None,
            thinking_time_ms: None,
            context: None,
            is_error: false,
            created_at: now,
            updated_at: now,
        }
    }

    /// Create a new system message.
    pub fn system(conversation_id: Uuid, content: impl Into<String>) -> Self {
        let now = chrono::Utc::now();
        Self {
            message_id: Uuid::new_v4(),
            conversation_id,
            parent_id: None,
            role: MessageRole::System,
            content: content.into(),
            mode: None,
            tokens_used: None,
            duration_ms: None,
            thinking_time_ms: None,
            context: None,
            is_error: false,
            created_at: now,
            updated_at: now,
        }
    }

    /// Set the parent message.
    pub fn with_parent(mut self, parent_id: Uuid) -> Self {
        self.parent_id = Some(parent_id);
        self
    }

    /// Set the mode.
    pub fn with_mode(mut self, mode: ConversationMode) -> Self {
        self.mode = Some(mode);
        self
    }

    /// Set the context.
    pub fn with_context(mut self, context: MessageContext) -> Self {
        self.context = Some(context);
        self
    }
}

/// Folder for organizing conversations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    /// Unique identifier.
    pub folder_id: Uuid,
    /// Tenant this folder belongs to.
    pub tenant_id: Uuid,
    /// Optional workspace scope.
    pub workspace_id: Option<Uuid>,
    /// User who owns this folder.
    pub user_id: Uuid,
    /// Folder name.
    pub name: String,
    /// Parent folder (for hierarchy).
    pub parent_id: Option<Uuid>,
    /// Display position.
    pub position: i32,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Last update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl Folder {
    /// Create a new folder.
    pub fn new(tenant_id: Uuid, user_id: Uuid, name: impl Into<String>) -> Self {
        let now = chrono::Utc::now();
        Self {
            folder_id: Uuid::new_v4(),
            tenant_id,
            workspace_id: None,
            user_id,
            name: name.into(),
            parent_id: None,
            position: 0,
            created_at: now,
            updated_at: now,
        }
    }

    /// Set the parent folder.
    pub fn with_parent(mut self, parent_id: Uuid) -> Self {
        self.parent_id = Some(parent_id);
        self
    }

    /// Set the workspace.
    pub fn with_workspace(mut self, workspace_id: Uuid) -> Self {
        self.workspace_id = Some(workspace_id);
        self
    }

    /// Set the position.
    pub fn with_position(mut self, position: i32) -> Self {
        self.position = position;
        self
    }
}
