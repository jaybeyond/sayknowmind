//! Mix query strategy — weighted combination of naive and graph-based.

use std::sync::Arc;

use async_trait::async_trait;

use super::config::{QueryStrategy, StrategyConfig};
use super::hybrid::HybridStrategy;
use super::naive::NaiveStrategy;
use crate::context::QueryContext;
use crate::error::Result;
use crate::modes::QueryMode;

use edgequake_storage::traits::{GraphStorage, VectorStorage};

/// Mix query strategy - weighted combination of naive and graph-based.
pub struct MixStrategy<V: VectorStorage, G: GraphStorage> {
    naive_strategy: NaiveStrategy<V>,
    hybrid_strategy: HybridStrategy<V, G>,
}

impl<V: VectorStorage, G: GraphStorage> MixStrategy<V, G> {
    /// Create a new mix strategy.
    pub fn new(vector_storage: Arc<V>, graph_storage: Arc<G>) -> Self {
        Self {
            naive_strategy: NaiveStrategy::new(Arc::clone(&vector_storage)),
            hybrid_strategy: HybridStrategy::new(vector_storage, graph_storage),
        }
    }
}

#[async_trait]
impl<V: VectorStorage, G: GraphStorage> QueryStrategy for MixStrategy<V, G> {
    async fn execute(
        &self,
        query: &str,
        query_embedding: &[f32],
        config: &StrategyConfig,
    ) -> Result<QueryContext> {
        // Weight-based combination
        let vector_count = (config.max_chunks as f32 * config.vector_weight).ceil() as usize;
        let graph_count = (config.max_entities as f32 * config.graph_weight).ceil() as usize;

        let mut naive_config = config.clone();
        naive_config.max_chunks = vector_count.max(1);

        let mut hybrid_config = config.clone();
        hybrid_config.max_entities = graph_count.max(1);
        hybrid_config.max_chunks = 0; // Don't duplicate chunk retrieval

        let naive_context = self
            .naive_strategy
            .execute(query, query_embedding, &naive_config)
            .await?;
        let hybrid_context = self
            .hybrid_strategy
            .execute(query, query_embedding, &hybrid_config)
            .await?;

        // Combine with weights
        let mut merged = QueryContext::new();

        // Add naive chunks
        for chunk in &naive_context.chunks {
            merged.add_chunk(chunk.clone());
        }

        // Add hybrid chunks (if any)
        for chunk in &hybrid_context.chunks {
            merged.add_chunk(chunk.clone());
        }

        // Add all entities from hybrid
        for entity in &hybrid_context.entities {
            merged.add_entity(entity.clone());
        }

        // Add all relationships from hybrid
        for rel in &hybrid_context.relationships {
            merged.add_relationship(rel.clone());
        }

        Ok(merged)
    }

    fn mode(&self) -> QueryMode {
        QueryMode::Mix
    }
}
