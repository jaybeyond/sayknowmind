//! Personalized PageRank (PPR) + Reciprocal Rank Fusion (RRF).
//!
//! HippoRAG-2-style multi-hop retrieval math, hand-rolled in pure Rust (no
//! petgraph/GPU/Python). Used by `SOTAQueryEngine::query_ppr` behind the
//! default-OFF `QueryMode::Ppr`. Kept dependency-free and side-effect-free so
//! the algorithm is unit-testable without any graph store or live EdgeQuake.
//!
//! WHY power iteration: AGE has no PPR primitive and Cypher can't express it
//! efficiently. We pull a bounded subgraph via the GraphStorage trait, build a
//! CSR-ish adjacency in memory, and iterate `r = alpha*s + (1-alpha)*Pᵀr`.

use std::collections::HashMap;
use std::hash::Hash;

/// Power-iteration parameters (HippoRAG/LightRAG defaults).
#[derive(Debug, Clone, Copy)]
pub struct PprConfig {
    /// Restart (teleport) probability — mass returned to the seed vector each
    /// step. Higher = stays closer to seeds (less multi-hop drift). HippoRAG 0.15.
    pub alpha: f32,
    /// Maximum power-iteration steps before giving up convergence.
    pub max_iter: usize,
    /// L1 convergence threshold on the score delta between iterations.
    pub epsilon: f32,
}

impl Default for PprConfig {
    fn default() -> Self {
        Self {
            alpha: 0.15,
            max_iter: 50,
            epsilon: 1e-6,
        }
    }
}

/// Result of a PPR run.
#[derive(Debug, Clone)]
pub struct PprResult {
    /// Stationary-ish score per node index (sums to ~1.0).
    pub scores: Vec<f32>,
    /// Iterations actually executed.
    pub iterations: usize,
    /// Whether L1 delta fell below `epsilon` before `max_iter`.
    pub converged: bool,
}

/// Run Personalized PageRank over `n` nodes via power iteration.
///
/// - `edges`: directed `(src, dst)` index pairs. For an undirected entity graph,
///   the caller should add both directions.
/// - `personalization`: restart distribution `s` (need not be normalized). All
///   zero (or empty) falls back to a uniform vector, i.e. plain PageRank.
///
/// Dangling nodes (out-degree 0) teleport their mass via `s` so probability is
/// conserved (sum stays ~1.0) and no rank is lost into a sink.
pub fn personalized_pagerank(
    n: usize,
    edges: &[(usize, usize)],
    personalization: &[f32],
    cfg: &PprConfig,
) -> PprResult {
    if n == 0 {
        return PprResult {
            scores: Vec::new(),
            iterations: 0,
            converged: true,
        };
    }

    // Normalize the personalization vector into a probability distribution `s`.
    let mut s = vec![0.0f32; n];
    let p_sum: f32 = personalization
        .iter()
        .take(n)
        .copied()
        .filter(|x| *x > 0.0)
        .sum();
    if p_sum > 0.0 {
        for (i, si) in s.iter_mut().enumerate() {
            let v = personalization.get(i).copied().unwrap_or(0.0);
            *si = if v > 0.0 { v / p_sum } else { 0.0 };
        }
    } else {
        let u = 1.0 / n as f32;
        for v in s.iter_mut() {
            *v = u;
        }
    }

    // Out-degree per node.
    let mut out_deg = vec![0usize; n];
    for &(src, _dst) in edges {
        if src < n {
            out_deg[src] += 1;
        }
    }

    let alpha = cfg.alpha;
    let mut r = s.clone();
    let mut next = vec![0.0f32; n];
    let mut iterations = 0;
    let mut converged = false;

    for _ in 0..cfg.max_iter.max(1) {
        iterations += 1;

        // Base: teleport mass to the seed distribution.
        for j in 0..n {
            next[j] = alpha * s[j];
        }

        // Dangling mass (nodes with no out-edges) teleports via `s`.
        let mut dangling = 0.0f32;
        for i in 0..n {
            if out_deg[i] == 0 {
                dangling += r[i];
            }
        }
        if dangling > 0.0 {
            let spread = (1.0 - alpha) * dangling;
            for j in 0..n {
                next[j] += spread * s[j];
            }
        }

        // Push mass along edges: each i contributes r[i]/outdeg[i] to each dst.
        for &(src, dst) in edges {
            if src < n && dst < n && out_deg[src] > 0 {
                next[dst] += (1.0 - alpha) * r[src] / out_deg[src] as f32;
            }
        }

        // L1 convergence check.
        let mut delta = 0.0f32;
        for j in 0..n {
            delta += (next[j] - r[j]).abs();
        }
        std::mem::swap(&mut r, &mut next);
        if delta < cfg.epsilon {
            converged = true;
            break;
        }
    }

    PprResult {
        scores: r,
        iterations,
        converged,
    }
}

/// Reciprocal Rank Fusion over multiple rankings.
///
/// Each ranking is an ordered list of item ids (best first). The fused score of
/// an item is `Σ 1/(k + rank)` across the rankings it appears in (rank 1-based).
/// RRF is scale-free, so it fuses the heterogeneous PPR-passage and dense-chunk
/// score spaces without normalization. Returns items sorted by score desc.
pub fn reciprocal_rank_fusion<T>(rankings: &[Vec<T>], k: f32) -> Vec<(T, f32)>
where
    T: Eq + Hash + Clone,
{
    let mut scores: HashMap<T, f32> = HashMap::new();
    // Preserve first-seen order for deterministic tie-breaking.
    let mut order: Vec<T> = Vec::new();
    for ranking in rankings {
        for (idx, item) in ranking.iter().enumerate() {
            let rank = (idx + 1) as f32;
            let contrib = 1.0 / (k + rank);
            scores
                .entry(item.clone())
                .and_modify(|s| *s += contrib)
                .or_insert_with(|| {
                    order.push(item.clone());
                    contrib
                });
        }
    }
    let mut fused: Vec<(T, f32)> = order
        .into_iter()
        .map(|item| {
            let s = scores.get(&item).copied().unwrap_or(0.0);
            (item, s)
        })
        .collect();
    // Stable sort by score desc; equal scores keep first-seen order.
    fused.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    fused
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32, tol: f32) -> bool {
        (a - b).abs() <= tol
    }

    #[test]
    fn empty_graph_is_safe() {
        let res = personalized_pagerank(0, &[], &[], &PprConfig::default());
        assert!(res.scores.is_empty());
        assert!(res.converged);
    }

    #[test]
    fn scores_sum_to_one() {
        // 4-node directed cycle 0->1->2->3->0.
        let edges = [(0, 1), (1, 2), (2, 3), (3, 0)];
        let res = personalized_pagerank(4, &edges, &[], &PprConfig::default());
        let sum: f32 = res.scores.iter().sum();
        assert!(approx(sum, 1.0, 1e-3), "sum was {sum}");
        // Symmetric cycle + uniform teleport => ~uniform stationary distribution.
        for v in &res.scores {
            assert!(approx(*v, 0.25, 1e-2), "score {v} not ~0.25");
        }
    }

    #[test]
    fn personalization_concentrates_mass_near_seed() {
        // Star: hub 0 connected (both ways) to leaves 1,2,3.
        let edges = [(0, 1), (1, 0), (0, 2), (2, 0), (0, 3), (3, 0)];
        // Seed only node 1.
        let mut pers = vec![0.0; 4];
        pers[1] = 1.0;
        let res = personalized_pagerank(4, &edges, &pers, &PprConfig::default());
        // The seeded leaf must outscore the other (symmetric) leaves.
        assert!(res.scores[1] > res.scores[2], "seed leaf should win");
        assert!(res.scores[1] > res.scores[3]);
        assert!(
            approx(res.scores[2], res.scores[3], 1e-4),
            "non-seed leaves symmetric"
        );
        // NB: a bipartite star mixes slowly (oscillating component decays ~0.85^k
        // at alpha=0.15), so it may not hit the tight 1e-6 L1 delta within the
        // default 50 iters — the ranking is stable long before that. We assert the
        // seed-concentration property (above), not strict convergence here.
        assert!(res.scores.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn multi_hop_reachable_beats_unreachable() {
        // 0 (seed) -> 1 -> 2 ; node 3 is isolated (unreachable).
        let edges = [(0, 1), (1, 0), (1, 2), (2, 1)];
        let mut pers = vec![0.0; 4];
        pers[0] = 1.0;
        let res = personalized_pagerank(4, &edges, &pers, &PprConfig::default());
        // The 2-hop-reachable node 2 must score above the unreachable node 3.
        assert!(
            res.scores[2] > res.scores[3],
            "reachable 2-hop must beat unreachable"
        );
    }

    #[test]
    fn dangling_node_no_nan() {
        // 0 -> 1, node 1 is a sink (dangling, no out-edges).
        let edges = [(0, 1)];
        let res = personalized_pagerank(2, &edges, &[], &PprConfig::default());
        assert!(res.scores.iter().all(|s| s.is_finite()), "no NaN/inf");
        let sum: f32 = res.scores.iter().sum();
        assert!(approx(sum, 1.0, 1e-3), "dangling mass conserved, sum {sum}");
    }

    #[test]
    fn rrf_item_high_in_both_wins() {
        let r1 = vec!["a", "b", "c"];
        let r2 = vec!["b", "a", "d"];
        let fused = reciprocal_rank_fusion(&[r1, r2], 60.0);
        // "a" (1,2) and "b" (2,1) are tied; both beat c/d which appear once.
        assert_eq!(fused[0].0, "a"); // first-seen tie-break keeps "a" first
        assert!(fused[0].1 > fused[2].1);
        let items: Vec<&str> = fused.iter().map(|(i, _)| *i).collect();
        assert!(items.contains(&"c") && items.contains(&"d"));
        // c and d each appear once -> lowest scores.
        let c_score = fused.iter().find(|(i, _)| *i == "c").unwrap().1;
        let b_score = fused.iter().find(|(i, _)| *i == "b").unwrap().1;
        assert!(b_score > c_score);
    }

    #[test]
    fn rrf_empty_is_empty() {
        let fused: Vec<(String, f32)> = reciprocal_rank_fusion::<String>(&[], 60.0);
        assert!(fused.is_empty());
    }
}
