//! Document graph lineage DTOs.

use serde::Serialize;
use utoipa::ToSchema;

/// Graph lineage summary for a document.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DocumentGraphLineageResponse {
    /// Document ID.
    pub document_id: String,
    /// Total chunks in document.
    pub chunk_count: usize,
    /// Entities extracted from this document.
    pub entities: Vec<EntitySummaryResponse>,
    /// Relationships extracted from this document.
    pub relationships: Vec<RelationshipSummaryResponse>,
    /// Extraction statistics.
    pub extraction_stats: ExtractionStatsResponse,
}

/// Entity summary in lineage response.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EntitySummaryResponse {
    /// Entity name.
    pub name: String,
    /// Entity type.
    pub entity_type: String,
    /// Source chunk IDs.
    pub source_chunks: Vec<String>,
    /// Whether entity is shared with other documents.
    pub is_shared: bool,
}

/// Relationship summary in lineage response.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RelationshipSummaryResponse {
    /// Source entity.
    pub source: String,
    /// Target entity.
    pub target: String,
    /// Relationship keywords.
    pub keywords: String,
    /// Source chunk IDs.
    pub source_chunks: Vec<String>,
}

/// Extraction statistics.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ExtractionStatsResponse {
    /// Total entities extracted.
    pub total_entities: usize,
    /// Unique entities (after deduplication).
    pub unique_entities: usize,
    /// Total relationships extracted.
    pub total_relationships: usize,
    /// Unique relationships.
    pub unique_relationships: usize,
    /// Processing time in milliseconds.
    pub processing_time_ms: Option<u64>,
}
