//! Helper functions and query parameter types for conversations API.
//!
//! Contains nullable field deserialization, default value functions,
//! and pagination/filter query parameter structs.

use serde::{Deserialize, Deserializer};
use utoipa::ToSchema;
use uuid::Uuid;

// ============================================================================
// Nullable field helpers
// ============================================================================

/// Deserializes an `Option<Option<T>>` to support explicit null values in JSON.
///
/// - If the field is absent in JSON -> `None` (don't update)
/// - If the field is `null` in JSON -> `Some(None)` (set to null)
/// - If the field has a value in JSON -> `Some(Some(value))` (set to value)
///
/// WHY: Standard `Option<T>` cannot distinguish between "field absent" and
/// "field present but null" in JSON. This pattern enables explicit null assignment,
/// required for operations like "remove conversation from folder".
pub fn deserialize_nullable<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    let opt: Option<T> = Option::deserialize(deserializer)?;
    Ok(Some(opt))
}

// ============================================================================
// Default value helper functions
// ============================================================================

/// Default pagination limit for conversations.
pub fn conversations_default_limit() -> usize {
    20
}

/// Default sort field for conversations.
pub fn default_sort() -> String {
    "updated_at".to_string()
}

/// Default sort order.
pub fn default_order() -> String {
    "desc".to_string()
}

/// Default pagination limit for messages.
pub fn default_messages_limit() -> usize {
    50
}

/// Default streaming mode for conversations.
pub fn conversations_default_stream() -> bool {
    true
}

// ============================================================================
// Query Parameters
// ============================================================================

/// Pagination and filter parameters for listing conversations.
#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct ListConversationsParams {
    /// Cursor for pagination.
    pub cursor: Option<String>,
    /// Maximum items to return (default 20, max 100).
    #[serde(default = "conversations_default_limit")]
    pub limit: usize,
    /// Filter by mode (comma-separated: local,global,hybrid).
    #[serde(rename = "filter[mode]")]
    pub filter_mode: Option<String>,
    /// Filter by archived status.
    #[serde(rename = "filter[archived]")]
    pub filter_archived: Option<bool>,
    /// Filter by pinned status.
    #[serde(rename = "filter[pinned]")]
    pub filter_pinned: Option<bool>,
    /// Filter by folder ID.
    #[serde(rename = "filter[folder_id]")]
    pub filter_folder_id: Option<Uuid>,
    /// Filter for conversations without a folder (unfiled).
    /// When true, returns only conversations where folder_id IS NULL.
    #[serde(rename = "filter[unfiled]")]
    pub filter_unfiled: Option<bool>,
    /// Search in title.
    #[serde(rename = "filter[search]")]
    pub filter_search: Option<String>,
    /// Sort field (updated_at, created_at, title).
    #[serde(default = "default_sort")]
    pub sort: String,
    /// Sort order (asc, desc).
    #[serde(default = "default_order")]
    pub order: String,
}

/// Pagination parameters for listing messages.
#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct ListMessagesParams {
    /// Cursor for pagination.
    pub cursor: Option<String>,
    /// Maximum items to return (default 50, max 200).
    #[serde(default = "default_messages_limit")]
    pub limit: usize,
}
