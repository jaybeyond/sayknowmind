//! Global query strategy — relationship-focused search.

use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;

use super::config::{QueryStrategy, StrategyConfig};
use crate::context::{QueryContext, RetrievedEntity, RetrievedRelationship};
use crate::error::Result;
use crate::modes::QueryMode;

use edgequake_storage::traits::{GraphStorage, VectorStorage};

/// Global query strategy - relationship-focused search.
pub struct GlobalStrategy<V: VectorStorage, G: GraphStorage> {
    pub(super) vector_storage: Arc<V>,
    pub(super) graph_storage: Arc<G>,
}

impl<V: VectorStorage, G: GraphStorage> GlobalStrategy<V, G> {
    /// Create a new global strategy.
    pub fn new(vector_storage: Arc<V>, graph_storage: Arc<G>) -> Self {
        Self {
            vector_storage,
            graph_storage,
        }
    }
}

#[async_trait]
impl<V: VectorStorage, G: GraphStorage> QueryStrategy for GlobalStrategy<V, G> {
    async fn execute(
        &self,
        _query: &str,
        query_embedding: &[f32],
        config: &StrategyConfig,
    ) -> Result<QueryContext> {
        let mut context = QueryContext::new();

        // Step 1: Vector search for relationships (as per LightRAG Global mode spec)
        // Global mode should search relations_vdb
        let vector_results = self
            .vector_storage
            .query(query_embedding, config.max_entities * 3, None) // Get more for filtering
            .await?;

        // Filter to relationship vectors only
        let relationship_results = crate::vector_filter::filter_by_type(
            vector_results,
            crate::vector_filter::VectorType::Relationship,
        );

        let mut seen_relationships = HashSet::new();
        let mut entity_ids = HashSet::new();

        // Step 2: Extract relationships from vector results
        for result in relationship_results.iter().take(config.max_entities * 2) {
            if result.score >= config.min_score {
                let src_id = result
                    .metadata
                    .get("src_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let tgt_id = result
                    .metadata
                    .get("tgt_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let rel_type = result
                    .metadata
                    .get("relation_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("RELATED_TO");

                if !src_id.is_empty() && !tgt_id.is_empty() {
                    let rel_key = format!("{}->{}:{}", src_id, tgt_id, rel_type);

                    if seen_relationships.insert(rel_key) {
                        let description = result
                            .metadata
                            .get("description")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        context.add_relationship(
                            RetrievedRelationship::new(src_id, tgt_id, rel_type.to_string())
                                .with_description(description),
                        );

                        // Track entities involved
                        entity_ids.insert(src_id.to_string());
                        entity_ids.insert(tgt_id.to_string());
                    }
                }
            }
        }

        // Step 3: Retrieve entity details for all entities in relationships
        for entity_id in entity_ids.iter().take(config.max_entities) {
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
            }
        }

        Ok(context)
    }

    fn mode(&self) -> QueryMode {
        QueryMode::Global
    }
}
