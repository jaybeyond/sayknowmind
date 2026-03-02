//! Configuration and trait definitions for query strategies.

use async_trait::async_trait;

use crate::context::QueryContext;
use crate::error::Result;
use crate::modes::QueryMode;

/// Configuration for query strategies.
#[derive(Debug, Clone)]
pub struct StrategyConfig {
    /// Maximum chunks to retrieve.
    pub max_chunks: usize,

    /// Maximum entities to retrieve.
    pub max_entities: usize,

    /// Maximum relationships per entity.
    pub max_relationships_per_entity: usize,

    /// Graph traversal depth.
    pub graph_depth: usize,

    /// Minimum similarity score threshold.
    pub min_score: f32,

    /// Weight for vector search results (0.0 - 1.0).
    pub vector_weight: f32,

    /// Weight for graph search results (0.0 - 1.0).
    pub graph_weight: f32,
}

impl Default for StrategyConfig {
    fn default() -> Self {
        Self {
            // WHY 20/60: Aligned with SOTAQueryConfig LightRAG-parity defaults.
            max_chunks: 20,
            max_entities: 60,
            max_relationships_per_entity: 5,
            graph_depth: 2,
            min_score: 0.1,
            vector_weight: 0.5,
            graph_weight: 0.5,
        }
    }
}

/// A query strategy that retrieves context based on a specific mode.
#[async_trait]
pub trait QueryStrategy: Send + Sync {
    /// Execute the strategy and return context.
    async fn execute(
        &self,
        query: &str,
        query_embedding: &[f32],
        config: &StrategyConfig,
    ) -> Result<QueryContext>;

    /// Get the query mode for this strategy.
    fn mode(&self) -> QueryMode;
}
