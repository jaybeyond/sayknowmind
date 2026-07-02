//! PPR mode (HippoRAG-2-style multi-hop) on the SOTA query engine.
//!
//! Default-OFF `QueryMode::Ppr`. Composes the prod-verified dense lane
//! (`query_naive`) and graph lane (`query_local`) with the unit-tested
//! Personalized-PageRank + RRF math in `crate::ppr`. PPR mass flows from
//! vector-seeded entities through the entity graph, is attributed back to
//! passages via each entity's `source_chunk_ids`, then fused with the dense
//! chunk ranking via Reciprocal Rank Fusion.
//!
//! ISOLATION: PPR inherits the dense (`query_naive`) and graph (`query_local`)
//! lanes' tenant/workspace filtering (fail-closed `matches_tenant_filter*`). The
//! PPR graph is built ONLY from the already-filtered local entities and the
//! edges among them — an edge to an entity outside that set is dropped — so PPR
//! adds no unfiltered graph expansion and cannot rank, or attribute mass to,
//! foreign nodes; emitted chunks are only ever those the filtered lanes already
//! returned. As with every mode, the web `readableClause` re-filter stays the
//! ultimate authority. The flag remains OFF in prod until an AGE-backed recall
//! benchmark justifies enabling it (latency is already benchmarked: ~3 ms at the
//! 5k-node cap — see `benches/ppr_bench.rs`).

use std::collections::HashMap;
use std::sync::Arc;

use edgequake_storage::traits::VectorStorage;

use super::{QueryEmbeddings, SOTAQueryEngine};
use crate::context::{QueryContext, RetrievedChunk};
use crate::keywords::ExtractedKeywords;
use crate::ppr::{personalized_pagerank, reciprocal_rank_fusion, PprConfig};
use crate::Result;

impl SOTAQueryEngine {
    /// Fuse a dense-lane context and a graph-lane (local) context via PPR + RRF.
    ///
    /// Pure/synchronous: all I/O already happened in the two lane queries. The
    /// entity graph (nodes = local entities, edges = local relationships) is
    /// walked by Personalized PageRank seeded with the entities' vector
    /// similarity scores; the resulting passage ranking is RRF-fused with the
    /// dense chunk ranking.
    fn fuse_ppr(&self, dense_ctx: QueryContext, local_ctx: QueryContext) -> QueryContext {
        let cfg = PprConfig {
            alpha: self.config.ppr_alpha,
            max_iter: self.config.ppr_max_iter,
            epsilon: self.config.ppr_epsilon,
        };
        // Candidate pool (not a hard top-K) so the web layer keeps its
        // visibility-aware top-up headroom.
        let cap = self.config.ppr_candidate_pool.max(self.config.max_chunks);
        fuse_ppr_contexts(dense_ctx, local_ctx, cfg, self.config.ppr_rrf_k, cap)
    }

    /// PPR mode over the default vector storage (primary live path).
    pub(super) async fn query_ppr(
        &self,
        keywords: &ExtractedKeywords,
        embeddings: &QueryEmbeddings,
        tenant_id: Option<String>,
        workspace_id: Option<String>,
    ) -> Result<QueryContext> {
        // The dense (vector) and local (graph) lanes are independent — run them
        // concurrently instead of serially so PPR latency is max(lanes), not the
        // sum (CODE-REVIEW cleanup). try_join! polls both on this task (no spawn,
        // so no Send bound) and short-circuits on the first error.
        let (dense, local) = tokio::try_join!(
            self.query_naive(embeddings, tenant_id.clone(), workspace_id.clone()),
            self.query_local(keywords, embeddings, tenant_id, workspace_id),
        )?;
        Ok(self.fuse_ppr(dense, local))
    }

    /// PPR mode over a workspace-specific vector storage.
    pub(super) async fn query_ppr_with_vector_storage(
        &self,
        keywords: &ExtractedKeywords,
        embeddings: &QueryEmbeddings,
        tenant_id: Option<String>,
        workspace_id: Option<String>,
        vector_storage: &Arc<dyn VectorStorage>,
    ) -> Result<QueryContext> {
        // Independent lanes — run concurrently (see query_ppr above).
        let (dense, local) = tokio::try_join!(
            self.query_naive_with_vector_storage(
                embeddings,
                tenant_id.clone(),
                workspace_id.clone(),
                vector_storage,
            ),
            self.query_local_with_vector_storage(
                keywords,
                embeddings,
                tenant_id,
                workspace_id,
                vector_storage,
            ),
        )?;
        Ok(self.fuse_ppr(dense, local))
    }
}

/// Pure PPR + RRF fusion of a dense-lane and a graph-lane (local) context.
///
/// Extracted from [`SOTAQueryEngine::fuse_ppr`] so the fusion — entity-graph
/// build, Personalized PageRank, passage attribution via `source_chunk_ids`,
/// and RRF — is unit-testable without constructing an engine or any storage.
///
/// Only chunks already present in `dense_ctx`/`local_ctx` (both tenant-filtered
/// by the upstream lane queries) are ever emitted, so PPR can never surface a
/// chunk the lane queries did not return. `cap` bounds the emitted pool.
pub(super) fn fuse_ppr_contexts(
    dense_ctx: QueryContext,
    local_ctx: QueryContext,
    cfg: PprConfig,
    rrf_k: f32,
    cap: usize,
) -> QueryContext {
    // Build the entity subgraph + PPR passage ranking. Scoped so all borrows of
    // local_ctx end before we move its fields into the output below.
    let ppr_chunk_ids: Vec<String> = {
        let entities = &local_ctx.entities;
        let n = entities.len();
        let name_to_idx: HashMap<&str, usize> = entities
            .iter()
            .enumerate()
            .map(|(i, e)| (e.name.as_str(), i))
            .collect();
        let mut edges: Vec<(usize, usize)> = Vec::new();
        for rel in &local_ctx.relationships {
            if let (Some(&a), Some(&b)) = (
                name_to_idx.get(rel.source.as_str()),
                name_to_idx.get(rel.target.as_str()),
            ) {
                // Undirected entity graph: push both directions.
                edges.push((a, b));
                edges.push((b, a));
            }
        }
        if n > 0 && !edges.is_empty() {
            let pers: Vec<f32> = entities.iter().map(|e| e.score.max(0.0)).collect();
            let res = personalized_pagerank(n, &edges, &pers, &cfg);
            // Attribute PPR node mass to passages via source_chunk_ids.
            let mut mass: HashMap<String, f32> = HashMap::new();
            for (i, e) in entities.iter().enumerate() {
                let m = res.scores.get(i).copied().unwrap_or(0.0);
                for cid in &e.source_chunk_ids {
                    *mass.entry(cid.clone()).or_insert(0.0) += m;
                }
            }
            let mut ranked: Vec<(String, f32)> = mass.into_iter().collect();
            ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            ranked.into_iter().map(|(id, _)| id).collect()
        } else {
            // No graph to walk -> PPR contributes nothing; dense lane carries.
            Vec::new()
        }
    };

    let dense_chunk_ids: Vec<String> = dense_ctx.chunks.iter().map(|c| c.id.clone()).collect();

    // RRF fuse the PPR-passage and dense-chunk rankings (scale-free).
    let fused = reciprocal_rank_fusion(&[ppr_chunk_ids, dense_chunk_ids], rrf_k);

    // Union of available chunks, keyed by id (dense lane wins on duplicates).
    let mut chunk_by_id: HashMap<String, RetrievedChunk> = HashMap::new();
    for c in dense_ctx
        .chunks
        .into_iter()
        .chain(local_ctx.chunks.into_iter())
    {
        chunk_by_id.entry(c.id.clone()).or_insert(c);
    }

    let mut out = QueryContext::new();
    // Carry graph context (entities/relationships) for the LLM prompt.
    for e in local_ctx.entities {
        out.add_entity(e);
    }
    for r in local_ctx.relationships {
        out.add_relationship(r);
    }
    // Emit chunks in fused-rank order, up to the candidate pool.
    for (cid, _score) in fused.into_iter().take(cap) {
        if let Some(chunk) = chunk_by_id.remove(&cid) {
            out.add_chunk(chunk);
        }
    }
    out
}

#[cfg(test)]
mod fuse_tests {
    use super::*;
    use crate::context::{RetrievedEntity, RetrievedRelationship};

    fn chunk(id: &str, score: f32) -> RetrievedChunk {
        RetrievedChunk::new(id, format!("content for {id}"), score)
    }

    fn entity(name: &str, score: f32, chunk_ids: &[&str]) -> RetrievedEntity {
        RetrievedEntity::new(name, "concept", "")
            .with_score(score)
            .with_source_chunk_ids(chunk_ids.iter().map(|s| s.to_string()).collect())
    }

    fn cfg() -> PprConfig {
        PprConfig::default()
    }

    #[test]
    fn empty_graph_falls_back_to_dense_order() {
        // No entities/relationships -> PPR contributes nothing; dense order wins.
        let mut dense = QueryContext::new();
        dense.add_chunk(chunk("c1", 0.9));
        dense.add_chunk(chunk("c2", 0.5));
        let local = QueryContext::new();

        let out = fuse_ppr_contexts(dense, local, cfg(), 60.0, 10);
        let ids: Vec<&str> = out.chunks.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["c1", "c2"]);
    }

    #[test]
    fn ppr_promotes_graph_attributed_chunk_above_dense_only() {
        // Dense order: c_dense (rank 1), c_far (rank 2).
        let mut dense = QueryContext::new();
        dense.add_chunk(chunk("c_dense", 0.9));
        dense.add_chunk(chunk("c_far", 0.4));

        // The seeded entity attributes its PPR mass to c_far, so c_far tops the
        // PPR lane. Appearing in BOTH lanes, RRF lifts it above the dense-only
        // c_dense.
        let mut local = QueryContext::new();
        local.add_entity(entity("Seed", 1.0, &["c_far"]));
        local.add_entity(entity("Hub", 0.2, &["c_far"]));
        local.add_relationship(RetrievedRelationship::new("Seed", "Hub", "rel"));

        let out = fuse_ppr_contexts(dense, local, cfg(), 60.0, 10);
        let ids: Vec<&str> = out.chunks.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(
            ids.first(),
            Some(&"c_far"),
            "PPR-boosted chunk should lead: {ids:?}"
        );
        assert!(ids.contains(&"c_dense"));
    }

    #[test]
    fn foreign_chunk_ids_are_dropped() {
        // An entity references a chunk id absent from both lanes (a graph-
        // connected foreign passage). It must never be emitted.
        let mut dense = QueryContext::new();
        dense.add_chunk(chunk("c_ok", 0.5));

        let mut local = QueryContext::new();
        local.add_entity(entity("A", 1.0, &["c_foreign"]));
        local.add_entity(entity("B", 0.5, &["c_ok"]));
        local.add_relationship(RetrievedRelationship::new("A", "B", "rel"));

        let out = fuse_ppr_contexts(dense, local, cfg(), 60.0, 10);
        let ids: Vec<&str> = out.chunks.iter().map(|c| c.id.as_str()).collect();
        assert!(
            !ids.contains(&"c_foreign"),
            "foreign chunk must be dropped: {ids:?}"
        );
        assert!(ids.contains(&"c_ok"));
    }

    #[test]
    fn cap_bounds_emitted_chunks() {
        let mut dense = QueryContext::new();
        for i in 0..5 {
            dense.add_chunk(chunk(&format!("c{i}"), 1.0 - i as f32 * 0.1));
        }
        let local = QueryContext::new();

        let out = fuse_ppr_contexts(dense, local, cfg(), 60.0, 2);
        assert_eq!(out.chunks.len(), 2, "cap should bound emitted chunks");
    }

    #[test]
    fn graph_context_is_carried_for_prompt() {
        let mut dense = QueryContext::new();
        dense.add_chunk(chunk("c1", 0.9));
        let mut local = QueryContext::new();
        local.add_entity(entity("E", 1.0, &["c1"]));
        local.add_relationship(RetrievedRelationship::new("E", "E", "self"));

        let out = fuse_ppr_contexts(dense, local, cfg(), 60.0, 10);
        assert_eq!(out.entities.len(), 1);
        assert_eq!(out.relationships.len(), 1);
    }

    #[test]
    fn edge_to_unknown_entity_is_ignored() {
        // A relationship references an entity ("Ghost") absent from the filtered
        // entity set (e.g. a neighbor that failed the tenant filter upstream). It
        // must be silently dropped from the PPR graph — never indexed, never given
        // mass, never panicking — so foreign nodes cannot influence the ranking.
        let mut dense = QueryContext::new();
        dense.add_chunk(chunk("c_self", 0.5));
        let mut local = QueryContext::new();
        local.add_entity(entity("Real", 1.0, &["c_self"]));
        local.add_relationship(RetrievedRelationship::new("Real", "Ghost", "rel"));

        let out = fuse_ppr_contexts(dense, local, cfg(), 60.0, 10);
        let ids: Vec<&str> = out.chunks.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["c_self"],
            "only in-tenant chunk surfaces: {ids:?}"
        );
    }
}
