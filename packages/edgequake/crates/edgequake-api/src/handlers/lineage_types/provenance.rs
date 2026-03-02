//! Entity provenance DTOs.

use serde::Serialize;
use utoipa::ToSchema;

/// Entity provenance response.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EntityProvenanceResponse {
    /// Entity ID.
    pub entity_id: String,
    /// Entity name.
    pub entity_name: String,
    /// Entity type.
    pub entity_type: String,
    /// Description.
    pub description: Option<String>,
    /// Source documents and chunks.
    pub sources: Vec<EntitySourceInfo>,
    /// Total extraction count.
    pub total_extraction_count: usize,
    /// Related entities.
    pub related_entities: Vec<RelatedEntityInfo>,
}

/// Entity source information.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EntitySourceInfo {
    /// Document ID.
    pub document_id: String,
    /// Document name.
    pub document_name: Option<String>,
    /// Chunks containing this entity.
    pub chunks: Vec<ChunkSourceInfo>,
    /// When first extracted.
    pub first_extracted_at: Option<String>,
}

/// Chunk source info.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ChunkSourceInfo {
    /// Chunk ID.
    pub chunk_id: String,
    /// Start line.
    pub start_line: Option<usize>,
    /// End line.
    pub end_line: Option<usize>,
    /// Source text excerpt.
    pub source_text: Option<String>,
}

/// Related entity info.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RelatedEntityInfo {
    /// Entity ID.
    pub entity_id: String,
    /// Entity name.
    pub entity_name: String,
    /// Relationship type.
    pub relationship_type: String,
    /// Shared document count.
    pub shared_documents: usize,
}
