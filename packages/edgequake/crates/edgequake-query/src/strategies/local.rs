//! Local query strategy — entity-centric search with neighborhood.

use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;

use super::config::{QueryStrategy, StrategyConfig};
use super::normalize_entity_name;
use crate::context::{QueryContext, RetrievedEntity, RetrievedRelationship};
use crate::error::Result;
use crate::modes::QueryMode;

use edgequake_storage::traits::{GraphStorage, VectorStorage};

/// Local query strategy - entity-centric search with neighborhood.
pub struct LocalStrategy<V: VectorStorage, G: GraphStorage> {
    pub(super) vector_storage: Arc<V>,
    pub(super) graph_storage: Arc<G>,
}

impl<V: VectorStorage, G: GraphStorage> LocalStrategy<V, G> {
    /// Create a new local strategy.
    pub fn new(vector_storage: Arc<V>, graph_storage: Arc<G>) -> Self {
        Self {
            vector_storage,
            graph_storage,
        }
    }
}

#[async_trait]
impl<V: VectorStorage, G: GraphStorage> QueryStrategy for LocalStrategy<V, G> {
    async fn execute(
        &self,
        _query: &str,
        query_embedding: &[f32],
        config: &StrategyConfig,
    ) -> Result<QueryContext> {
        let mut context = QueryContext::new();

        // Step 1: Vector search for entities (as per LightRAG Local mode spec)
        // Local mode should search entity_vdb, not chunks
        let vector_results = self
            .vector_storage
            .query(query_embedding, config.max_entities * 2, None) // Get more for filtering
            .await?;

        // Filter to entity vectors only
        let entity_results = crate::vector_filter::filter_by_type(
            vector_results,
            crate::vector_filter::VectorType::Entity,
        );

        let mut entity_ids = HashSet::new();

        // Step 2: Extract entity IDs from vector results
        for result in entity_results.iter().take(config.max_entities) {
            if result.score >= config.min_score {
                let entity_name = result
                    .metadata
                    .get("entity_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if !entity_name.is_empty() {
                    entity_ids.insert(normalize_entity_name(&entity_name));
                }
            }
        }

        // Step 3: Retrieve entities and their local graph neighborhoods
        for entity_id in &entity_ids {
            if let Some(node) = self.graph_storage.get_node(entity_id).await? {
                let entity_type = node
                    .properties
                    .get("entity_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("UNKNOWN")
                    .to_string();

                let description = node
                    .properties
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let degree = self.graph_storage.node_degree(entity_id).await?;

                context.add_entity(
                    RetrievedEntity::new(&node.id, entity_type, description).with_degree(degree),
                );

                // Get direct relationships (1-hop neighborhood)
                let edges = self.graph_storage.get_node_edges(entity_id).await?;
                for edge in edges.iter().take(config.max_relationships_per_entity) {
                    let rel_type = edge
                        .properties
                        .get("relation_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("RELATED_TO")
                        .to_string();

                    let description = edge
                        .properties
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    context.add_relationship(
                        RetrievedRelationship::new(&edge.source, &edge.target, rel_type)
                            .with_description(description),
                    );
                }
            }
        }

        Ok(context)
    }

    fn mode(&self) -> QueryMode {
        QueryMode::Local
    }
}
