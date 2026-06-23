//! Personalized PageRank latency / scaling benchmark.
//!
//! Answers the architect's `EQ_PPR_MAX_NODES = 5000` concern: how expensive is
//! the query-time PPR power iteration at the node cap? Pure in-memory math, no
//! DB — measures the load-bearing cost of [`personalized_pagerank`] (50 iters,
//! alpha 0.15) plus the [`reciprocal_rank_fusion`] step.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use edgequake_query::ppr::{personalized_pagerank, reciprocal_rank_fusion, PprConfig};

/// Deterministic synthetic graph: ~`avg_degree` undirected edges per node via
/// co-prime strides, so it is connected and genuinely multi-hop (not a chain).
fn build_graph(n: usize, avg_degree: usize) -> Vec<(usize, usize)> {
    let strides = [1usize, 7, 31, 101, 307, 1009];
    let mut edges = Vec::with_capacity(n * avg_degree * 2);
    for i in 0..n {
        for s in strides.iter().take(avg_degree) {
            let j = (i.wrapping_mul(*s).wrapping_add(*s)) % n;
            if j != i {
                edges.push((i, j));
                edges.push((j, i));
            }
        }
    }
    edges
}

/// Sparse vector-seed personalization: a handful of seed entities carry mass,
/// mirroring how the dense lane seeds PPR in production.
fn build_seeds(n: usize, seeds: usize) -> Vec<f32> {
    let mut p = vec![0.0f32; n];
    for k in 0..seeds.min(n) {
        let idx = (k * 997) % n;
        p[idx] = 1.0 - (k as f32 / seeds as f32) * 0.5;
    }
    p
}

fn bench_ppr_scaling(c: &mut Criterion) {
    let cfg = PprConfig::default(); // alpha 0.15, 50 iters, eps 1e-6
    let mut group = c.benchmark_group("ppr_power_iteration");
    for &n in &[100usize, 1000, 5000] {
        let edges = build_graph(n, 6);
        let seeds = build_seeds(n, 20);
        group.bench_with_input(BenchmarkId::from_parameter(n), &n, |b, _| {
            b.iter(|| {
                let res = personalized_pagerank(
                    black_box(n),
                    black_box(&edges),
                    black_box(&seeds),
                    black_box(&cfg),
                );
                black_box(res.iterations)
            });
        });
    }
    group.finish();
}

fn bench_rrf(c: &mut Criterion) {
    let mut group = c.benchmark_group("rrf_fusion");
    for &size in &[50usize, 500] {
        let r1: Vec<usize> = (0..size).collect();
        let r2: Vec<usize> = (0..size).rev().collect();
        let rankings = [r1, r2];
        group.bench_with_input(BenchmarkId::from_parameter(size), &size, |b, _| {
            b.iter(|| {
                let fused = reciprocal_rank_fusion(black_box(&rankings), 60.0);
                black_box(fused.len())
            });
        });
    }
    group.finish();
}

criterion_group!(benches, bench_ppr_scaling, bench_rrf);
criterion_main!(benches);
