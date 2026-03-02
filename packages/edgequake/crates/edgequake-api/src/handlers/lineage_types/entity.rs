//! Entity lineage DTOs.

use serde::Serialize;
use utoipa::ToSchema;

/// Entity lineage response showing all source documents.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EntityLineageResponse {
    /// Entity name.
    pub entity_name: String,
    /// Entity type.
    pub entity_type: Option<String>,
    /// All source documents this entity was extracted from.
    pub source_documents: Vec<SourceDocumentInfo>,
    /// Number of unique source documents.
    pub source_count: usize,
    /// Description history.
    pub description_versions: Vec<DescriptionVersionResponse>,
}

/// Information about a source document.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SourceDocumentInfo {
    /// Document ID.
    pub document_id: String,
    /// Chunk IDs within this document.
    pub chunk_ids: Vec<String>,
    /// Line ranges where entity was found.
    pub line_ranges: Vec<LineRangeInfo>,
}

/// Line range information.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct LineRangeInfo {
    /// Start line (1-indexed).
    pub start_line: usize,
    /// End line (1-indexed).
    pub end_line: usize,
}

/// Description version for tracking evolution.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DescriptionVersionResponse {
    /// Version number.
    pub version: usize,
    /// Description text.
    pub description: String,
    /// Source chunk that provided this description.
    pub source_chunk_id: Option<String>,
    /// When this version was created.
    pub created_at: String,
}
