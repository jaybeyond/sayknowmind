//! Relationship CRUD operations for manual knowledge graph management.
//!
//! | Sub-module | Responsibility                                    |
//! |------------|---------------------------------------------------|
//! | `helpers`  | Entity normalization, type extraction, conversion |
//! | `list`     | List relationships with pagination (FEAT0530)     |
//! | `create`   | Create relationship with validation (FEAT0531)    |
//! | `get`      | Get single relationship by ID                     |
//! | `update`   | Update relationship fields (FEAT0532)             |
//! | `delete`   | Delete relationship (FEAT0533)                    |
//!
//! ## Enforces
//!
//! - **BR0530**: Entity names must be normalized (UPPERCASE with underscores)
//! - **BR0531**: Relationships must have valid source and target entities
//! - **BR0532**: Relationship weights must be between 0.0 and 1.0

mod create;
mod delete;
mod get;
mod helpers;
mod list;
mod update;

pub use create::*;
pub use delete::*;
pub use get::*;
pub use list::*;
pub use update::*;

// Re-export DTOs for backward compatibility
pub use crate::handlers::relationships_types::{
    default_weight, CreateRelationshipRequest, CreateRelationshipResponse,
    DeleteRelationshipResponse, EntitySummary, GetRelationshipResponse, ListRelationshipsQuery,
    ListRelationshipsResponse, RelationshipChangesSummary, RelationshipEntities,
    RelationshipResponse, UpdateRelationshipRequest, UpdateRelationshipResponse,
};

#[cfg(test)]
mod tests {
    use super::helpers::{extract_relation_type, normalize_entity_name};
    use super::*;

    #[test]
    fn test_extract_relation_type() {
        assert_eq!(extract_relation_type("works for, employed by"), "WORKS_FOR");
        assert_eq!(extract_relation_type("located in"), "LOCATED_IN");
        assert_eq!(extract_relation_type(""), "RELATED_TO");
    }

    #[test]
    fn test_normalize_entity_name() {
        assert_eq!(
            normalize_entity_name("quantum computing"),
            "QUANTUM_COMPUTING"
        );
    }

    #[test]
    fn test_create_relationship_request_defaults() {
        let json = r#"{
            "src_id": "ENTITY_A",
            "tgt_id": "ENTITY_B",
            "keywords": "works for",
            "description": "Employment relationship",
            "source_id": "manual_entry"
        }"#;
        let request: Result<CreateRelationshipRequest, _> = serde_json::from_str(json);
        assert!(request.is_ok());
        let req = request.unwrap();
        assert_eq!(req.src_id, "ENTITY_A");
        assert_eq!(req.weight, 0.8); // default
    }

    #[test]
    fn test_create_relationship_request_custom_weight() {
        let json = r#"{
            "src_id": "A",
            "tgt_id": "B",
            "keywords": "connects",
            "weight": 0.5,
            "description": "test",
            "source_id": "doc-1"
        }"#;
        let request: Result<CreateRelationshipRequest, _> = serde_json::from_str(json);
        assert!(request.is_ok());
        let req = request.unwrap();
        assert!((req.weight - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_update_relationship_request_partial() {
        let json = r#"{"weight": 0.9}"#;
        let request: Result<UpdateRelationshipRequest, _> = serde_json::from_str(json);
        assert!(request.is_ok());
        let req = request.unwrap();
        assert_eq!(req.weight, Some(0.9));
        assert!(req.keywords.is_none());
    }

    #[test]
    fn test_default_weight() {
        assert!((default_weight() - 0.8).abs() < f64::EPSILON);
    }
}
