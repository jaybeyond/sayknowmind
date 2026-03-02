//! Conversation DTO types.
//!
//! This module contains all Data Transfer Objects for the conversations API.
//!
//! ## Sub-modules
//!
//! | Module      | Responsibility                                     |
//! |-------------|---------------------------------------------------|
//! | `helpers`   | Nullable deserialization, defaults, query params   |
//! | `responses` | Response DTOs with From impls for domain models    |
//! | `requests`  | Request DTOs, bulk operations, import/export       |

mod helpers;
mod requests;
mod responses;

pub use helpers::*;
pub use requests::*;
pub use responses::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_conversations_default_limit() {
        assert_eq!(conversations_default_limit(), 20);
    }

    #[test]
    fn test_default_messages_limit() {
        assert_eq!(default_messages_limit(), 50);
    }

    #[test]
    fn test_default_sort() {
        assert_eq!(default_sort(), "updated_at");
    }

    #[test]
    fn test_default_order() {
        assert_eq!(default_order(), "desc");
    }

    #[test]
    fn test_conversations_default_stream() {
        assert!(conversations_default_stream());
    }

    #[test]
    fn test_pagination_meta_serialization() {
        let meta = PaginationMetaResponse {
            next_cursor: Some("cursor123".to_string()),
            prev_cursor: None,
            total: Some(100),
            has_more: true,
        };
        let json = serde_json::to_value(&meta).unwrap();
        assert_eq!(json["next_cursor"], "cursor123");
        assert!(json["has_more"].as_bool().unwrap());
    }

    #[test]
    fn test_share_response_serialization() {
        let share = ShareResponse {
            share_id: "abc123".to_string(),
            share_url: "https://example.com/share/abc123".to_string(),
        };
        let json = serde_json::to_value(&share).unwrap();
        assert_eq!(json["share_id"], "abc123");
        assert!(json["share_url"].as_str().unwrap().contains("share"));
    }

    #[test]
    fn test_bulk_operation_response_serialization() {
        let resp = BulkOperationResponse { affected: 5 };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["affected"], 5);
    }

    #[test]
    fn test_import_error_response_serialization() {
        let err = ImportErrorResponse {
            id: "conv123".to_string(),
            error: "Parse error".to_string(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["id"], "conv123");
        assert_eq!(json["error"], "Parse error");
    }

    #[test]
    fn test_create_conversation_request_deserialization() {
        let json = r#"{"title": "Test", "mode": "hybrid"}"#;
        let req: CreateConversationApiRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.title, Some("Test".to_string()));
        assert_eq!(req.mode, Some("hybrid".to_string()));
    }

    #[test]
    fn test_create_message_request_defaults() {
        let json = r#"{"content": "Hello", "role": "user"}"#;
        let req: CreateMessageApiRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.content, "Hello");
        assert!(req.stream); // default is true
    }

    #[test]
    fn test_bulk_archive_request_deserialization() {
        let json =
            r#"{"conversation_ids": ["550e8400-e29b-41d4-a716-446655440000"], "archive": true}"#;
        let req: BulkArchiveRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.conversation_ids.len(), 1);
        assert!(req.archive);
    }
}
