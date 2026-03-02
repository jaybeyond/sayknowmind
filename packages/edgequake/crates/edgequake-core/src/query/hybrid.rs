//! Hybrid RAG: Combines local and global modes with round-robin interleaving.

use crate::error::Result;
use crate::types::{
    ContextEntity, ContextRelationship, QueryContext, QueryMode, QueryParams, QueryResult,
    QueryStats,
};
use std::collections::HashSet;

impl super::QueryEngine {
    /// Hybrid RAG: Combines local and global modes with round-robin interleaving.
    ///
    /// WHY: Uses LightRAG-style round-robin merge to ensure both local (entity-centric)
    /// and global (relationship-centric) results are well-represented in the final context.
    /// Simple concatenation would bias toward local mode, causing global context to be cut off.
    pub(super) async fn query_hybrid(
        &self,
        query: &str,
        params: &QueryParams,
    ) -> Result<QueryResult> {
        let retrieval_start = std::time::Instant::now();

        // 1. Run local query (entity-centric)
        let local_result = self.query_local(query, params).await?;

        // 2. Run global query (relationship-centric)
        let global_result = self.query_global(query, params).await?;

        // 3. Round-robin merge contexts (LightRAG pattern)
        // WHY: Interleaved merge ensures diverse context from both local and global
        // Pattern: [L1, G1, L2, G2, ...] instead of [L1, L2, ..., G1, G2, ...]
        let merged_entities = Self::round_robin_merge_entities(
            &local_result.context.entities,
            &global_result.context.entities,
        );

        let merged_relationships = Self::round_robin_merge_relationships(
            &local_result.context.relationships,
            &global_result.context.relationships,
        );

        tracing::debug!(
            local_entities = local_result.context.entities.len(),
            global_entities = global_result.context.entities.len(),
            merged_entities = merged_entities.len(),
            local_rels = local_result.context.relationships.len(),
            global_rels = global_result.context.relationships.len(),
            merged_rels = merged_relationships.len(),
            "Hybrid merge stats (round-robin)"
        );

        // Build context
        let mut context_text = String::new();

        context_text.push_str("### Entities ###\n\n");
        for entity in &merged_entities {
            context_text.push_str(&format!(
                "**{}** ({}): {}\n",
                entity.name, entity.entity_type, entity.description
            ));
        }

        context_text.push_str("\n### Relationships ###\n\n");
        for rel in &merged_relationships {
            context_text.push_str(&format!(
                "- {} → {}: {}\n",
                rel.source, rel.target, rel.description
            ));
        }

        let retrieval_time_ms = retrieval_start.elapsed().as_millis() as u64;
        let generation_start = std::time::Instant::now();

        let prompt = format!(
            "Answer the following question based on the provided knowledge graph context (entities and relationships).\n\nContext:\n{}\n\nQuestion: {}\n\nAnswer:",
            context_text, query
        );

        let response = self
            .llm
            .complete(&prompt)
            .await
            .map_err(|e| crate::error::Error::internal(format!("LLM error: {}", e)))?;

        let generation_time_ms = generation_start.elapsed().as_millis() as u64;

        // Calculate stats before moving values
        let relationships_count = merged_relationships.len();

        Ok(QueryResult {
            response: response.content,
            mode: QueryMode::Hybrid,
            context: QueryContext {
                entities: merged_entities,
                relationships: merged_relationships,
                ..Default::default()
            },
            stats: QueryStats {
                retrieval_time_ms,
                generation_time_ms,
                total_time_ms: 0,
                entities_retrieved: local_result.stats.entities_retrieved
                    + global_result.stats.entities_retrieved,
                relationships_retrieved: relationships_count,
                prompt_tokens: response.prompt_tokens,
                response_tokens: response.completion_tokens,
                ..Default::default()
            },
        })
    }

    /// Round-robin interleave merge for entities.
    ///
    /// WHY: Simple concatenation (local ++ global) biases toward local mode, causing
    /// global context to be cut off. LightRAG uses interleaved merging to ensure
    /// both local and global results are represented in the final context.
    ///
    /// Pattern: [L1, G1, L2, G2, L3, G3, ...] instead of [L1, L2, L3, G1, G2, G3]
    fn round_robin_merge_entities(
        local: &[ContextEntity],
        global: &[ContextEntity],
    ) -> Vec<ContextEntity> {
        let mut merged = Vec::new();
        let mut seen_names = HashSet::new();
        let max_len = local.len().max(global.len());

        for i in 0..max_len {
            // Add local item at position i (if not already seen)
            if let Some(entity) = local.get(i) {
                if seen_names.insert(entity.name.clone()) {
                    merged.push(entity.clone());
                }
            }

            // Add global item at position i (if not already seen)
            if let Some(entity) = global.get(i) {
                if seen_names.insert(entity.name.clone()) {
                    merged.push(entity.clone());
                }
            }
        }

        merged
    }

    /// Round-robin interleave merge for relationships.
    fn round_robin_merge_relationships(
        local: &[ContextRelationship],
        global: &[ContextRelationship],
    ) -> Vec<ContextRelationship> {
        let mut merged = Vec::new();
        let mut seen_rels: HashSet<(String, String)> = HashSet::new();
        let max_len = local.len().max(global.len());

        for i in 0..max_len {
            if let Some(rel) = local.get(i) {
                let key = (rel.source.clone(), rel.target.clone());
                if seen_rels.insert(key) {
                    merged.push(rel.clone());
                }
            }

            if let Some(rel) = global.get(i) {
                let key = (rel.source.clone(), rel.target.clone());
                if seen_rels.insert(key) {
                    merged.push(rel.clone());
                }
            }
        }

        merged
    }
}
