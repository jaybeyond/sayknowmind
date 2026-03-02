//! Conversation and message enums.
//!
//! Defines the mode and role enumerations used across the conversation system.

use serde::{Deserialize, Serialize};

/// Conversation mode for RAG queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConversationMode {
    /// Local search only (entity-based).
    Local,
    /// Global search only (community summaries).
    Global,
    /// Hybrid search (combines local and global).
    #[default]
    Hybrid,
    /// Naive search (simple vector similarity).
    Naive,
    /// Mix mode (weighted combination).
    Mix,
}

impl std::fmt::Display for ConversationMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local => write!(f, "local"),
            Self::Global => write!(f, "global"),
            Self::Hybrid => write!(f, "hybrid"),
            Self::Naive => write!(f, "naive"),
            Self::Mix => write!(f, "mix"),
        }
    }
}

impl std::str::FromStr for ConversationMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "local" => Ok(Self::Local),
            "global" => Ok(Self::Global),
            "hybrid" => Ok(Self::Hybrid),
            "naive" => Ok(Self::Naive),
            "mix" => Ok(Self::Mix),
            _ => Err(format!("Unknown mode: {}", s)),
        }
    }
}

/// Message role in a conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    /// User message.
    User,
    /// Assistant response.
    Assistant,
    /// System message.
    System,
}

impl std::fmt::Display for MessageRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::User => write!(f, "user"),
            Self::Assistant => write!(f, "assistant"),
            Self::System => write!(f, "system"),
        }
    }
}

impl std::str::FromStr for MessageRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "user" => Ok(Self::User),
            "assistant" => Ok(Self::Assistant),
            "system" => Ok(Self::System),
            _ => Err(format!("Unknown role: {}", s)),
        }
    }
}
