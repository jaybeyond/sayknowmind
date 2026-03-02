//! Hybrid query strategy — combines local and global approaches.

use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;

use super::config::{QueryStrategy, StrategyConfig};
use super::global::GlobalStrategy;
use super::local::LocalStrategy;
use crate::context::QueryContext;
use crate::error::Result;
use crate::modes::QueryMode;

use edgequake_storage::traits::{GraphStorage, VectorStorage};

/// Hybrid query strategy - combines local and global approaches.
pub struct HybridStrategy<V: VectorStorage, G: GraphStorage> {
    local_strategy: LocalStrategy<V, G>,
    global_strategy: GlobalStrategy<V, G>,
}

impl<V: VectorStorage, G: GraphStorage> HybridStrategy<V, G> {
    /// Create a new hybrid strategy.
    pub fn new(vector_storage: Arc<V>, graph_storage: Arc<G>) -> Self {
        Self {
            local_strategy: LocalStrategy::new(
                Arc::clone(&vector_storage),
                Arc::clone(&graph_storage),
            ),
            global_strategy: GlobalStrategy::new(vector_storage, graph_storage),
        }
    }
}

#[async_trait]
impl<V: VectorStorage, G: GraphStorage> QueryStrategy for HybridStrategy<V, G> {
    async fn execute(
        &self,
        query: &str,
        query_embedding: &[f32],
        config: &StrategyConfig,
    ) -> Result<QueryContext> {
        // Run both strategies with reduced limits
        let mut local_config = config.clone();
        local_config.max_chunks /= 2;
        local_config.max_entities /= 2;

        let mut global_config = config.clone();
        global_config.max_entities /= 2;

        let local_context = self
            .local_strategy
            .execute(query, query_embedding, &local_config)
            .await?;
        let global_context = self
            .global_strategy
            .execute(query, query_embedding, &global_config)
            .await?;

        // Merge contexts
        let mut merged = QueryContext::new();

        // Add local chunks first (more relevant)
        for chunk in &local_context.chunks {
            merged.add_chunk(chunk.clone());
        }

        // Merge entities (deduplicate)
        let mut seen_entities = HashSet::new();
        for entity in local_context
            .entities
            .iter()
            .chain(global_context.entities.iter())
        {
            if seen_entities.insert(entity.name.clone()) {
                merged.add_entity(entity.clone());
            }
        }

        // Merge relationships (deduplicate)
        let mut seen_rels = HashSet::new();
        for rel in local_context
            .relationships
            .iter()
            .chain(global_context.relationships.iter())
        {
            let key = format!("{}->{}:{}", rel.source, rel.target, rel.relation_type);
            if seen_rels.insert(key) {
                merged.add_relationship(rel.clone());
            }
        }

        Ok(merged)
    }

    fn mode(&self) -> QueryMode {
        QueryMode::Hybrid
    }
}
