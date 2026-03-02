//! Local RAG: Entity-centric retrieval with keyword extraction and batch graph ops.

use crate::error::Result;
use crate::keyword_extractor::{ExtractedKeywords, KeywordExtractor};
use crate::types::{
    ContextEntity, ContextRelationship, QueryContext, QueryMode, QueryParams, QueryResult,
    QueryStats,
};
use std::collections::HashSet;
use std::sync::Arc;

impl super::QueryEngine {
    /// Local RAG: Entity-centric retrieval using BATCH operations + keyword extraction.
    ///
    /// This is the LightRAG-inspired optimized version that uses:
    /// 1. O(1) batch queries instead of O(N) individual queries for graph retrieval
    /// 2. Keyword extraction for semantic understanding (closing gap with LightRAG)
    /// 3. Multi-vector search: query + low-level keywords for better entity recall
    ///
    /// Performance: ~10ms for 50 entities (vs ~500ms with individual queries)
    pub(super) async fn query_local(
        &self,
        query: &str,
        params: &QueryParams,
    ) -> Result<QueryResult> {
        let retrieval_start = std::time::Instant::now();

        // WHY: Extract keywords first (LightRAG pattern) to understand query semantics
        // This helps find entities that match specific terms like "BYD Seal U" or "STLA Medium"
        let keyword_extractor = KeywordExtractor::new(Arc::clone(&self.llm));
        let keywords = keyword_extractor.extract(query).await.unwrap_or_else(|e| {
            tracing::warn!("Keyword extraction failed: {}, using empty keywords", e);
            ExtractedKeywords::default()
        });

        tracing::debug!(
            low_level = ?keywords.low_level,
            high_level = ?keywords.high_level,
            "Extracted keywords for local query"
        );

        // 1. Build search texts: query + low-level keywords for multi-vector search
        // WHY: Low-level keywords capture specific entity names that may not match
        // the overall query embedding (e.g., "STLA Medium" in French query)
        let mut search_texts = vec![query.to_string()];
        search_texts.extend(keywords.low_level.iter().take(5).cloned()); // Limit to top 5 keywords

        let all_embeddings = self
            .embedding
            .embed(&search_texts)
            .await
            .map_err(|e| crate::error::Error::internal(format!("Embedding error: {}", e)))?;

        // 2. Multi-vector search: search with each embedding and collect results
        // WHY: This ensures we find entities matching specific keywords even if
        // they don't match the overall query embedding well
        let per_vector_k = (params.top_k / all_embeddings.len().max(1)).max(3);
        let mut all_entity_results = Vec::new();
        let mut seen_ids = HashSet::new();

        for embedding in &all_embeddings {
            let results = self
                .vector_storage
                .query(embedding, per_vector_k, None)
                .await
                .map_err(|e| {
                    crate::error::Error::internal(format!("Vector search error: {}", e))
                })?;

            for result in results {
                if seen_ids.insert(result.id.clone()) {
                    all_entity_results.push(result);
                }
            }
        }

        // Sort by score and take top_k
        all_entity_results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let entity_results: Vec<_> = all_entity_results.into_iter().take(params.top_k).collect();

        // 3. Filter and collect entity IDs (pre-filter step)
        let mut entity_ids = Vec::new();
        let mut entity_scores: std::collections::HashMap<String, f32> =
            std::collections::HashMap::new();

        for result in &entity_results {
            // Filter by tenant/workspace
            if !self.matches_tenant(
                &result.metadata,
                params.tenant_id.as_deref(),
                params.workspace_id.as_deref(),
            ) {
                continue;
            }

            // Filter by type (only entities for local mode)
            if result.metadata.get("type").and_then(|v| v.as_str()) != Some("entity") {
                continue;
            }

            entity_ids.push(result.id.clone());
            entity_scores.insert(result.id.clone(), result.score);
        }

        // 4. BATCH: Retrieve all nodes at once (LightRAG pattern - O(1) instead of O(N))
        let nodes_map = self
            .graph_storage
            .get_nodes_batch(&entity_ids)
            .await
            .map_err(|e| {
                crate::error::Error::internal(format!("Batch node retrieval error: {}", e))
            })?;

        // 5. BATCH: Retrieve all edges connecting these nodes at once
        let edges = self
            .graph_storage
            .get_edges_for_nodes_batch(&entity_ids)
            .await
            .map_err(|e| {
                crate::error::Error::internal(format!("Batch edge retrieval error: {}", e))
            })?;

        // 6. Build context from batch results
        let mut context_entities = Vec::new();
        let mut context_relationships = Vec::new();
        let mut context_text = String::new();

        context_text.push_str("### Knowledge Graph Entities ###\n\n");

        for entity_id in &entity_ids {
            if let Some(node) = nodes_map.get(entity_id) {
                // Filter node by tenant/workspace
                if !self.matches_tenant(
                    &serde_json::Value::Object(node.properties.clone().into_iter().collect()),
                    params.tenant_id.as_deref(),
                    params.workspace_id.as_deref(),
                ) {
                    continue;
                }

                let score = entity_scores.get(entity_id).copied().unwrap_or(0.0);
                let name = node
                    .properties
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(entity_id)
                    .to_string();
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

                context_entities.push(ContextEntity {
                    name: name.clone(),
                    entity_type,
                    description: description.clone(),
                    score,
                });

                context_text.push_str(&format!("**{}**: {}\n\n", name, description));
            }
        }

        // Add relationships from batch query
        context_text.push_str("### Relationships ###\n\n");

        for edge in &edges {
            // Filter edge by tenant/workspace
            if !self.matches_tenant(
                &serde_json::Value::Object(edge.properties.clone().into_iter().collect()),
                params.tenant_id.as_deref(),
                params.workspace_id.as_deref(),
            ) {
                continue;
            }

            let relation_type = edge
                .properties
                .get("relation_type")
                .or_else(|| edge.properties.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("RELATED")
                .to_string();

            let description = edge
                .properties
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            context_relationships.push(ContextRelationship {
                source: edge.source.clone(),
                target: edge.target.clone(),
                relation_type: relation_type.clone(),
                description: description.clone(),
                score: 1.0,
            });

            context_text.push_str(&format!(
                "- {} --[{}]--> {}: {}\n",
                edge.source, relation_type, edge.target, description
            ));
        }

        let retrieval_time_ms = retrieval_start.elapsed().as_millis() as u64;
        let generation_start = std::time::Instant::now();

        // 7. Generate response
        let prompt = format!(
            "Answer the following question based on the provided knowledge graph context.\n\nContext:\n{}\n\nQuestion: {}\n\nAnswer:",
            context_text, query
        );

        let response = self
            .llm
            .complete(&prompt)
            .await
            .map_err(|e| crate::error::Error::internal(format!("LLM error: {}", e)))?;

        let generation_time_ms = generation_start.elapsed().as_millis() as u64;

        Ok(QueryResult {
            response: response.content,
            mode: QueryMode::Local,
            context: QueryContext {
                entities: context_entities,
                relationships: context_relationships,
                ..Default::default()
            },
            stats: QueryStats {
                retrieval_time_ms,
                generation_time_ms,
                total_time_ms: 0,
                entities_retrieved: entity_ids.len(),
                prompt_tokens: response.prompt_tokens,
                response_tokens: response.completion_tokens,
                ..Default::default()
            },
        })
    }
}
