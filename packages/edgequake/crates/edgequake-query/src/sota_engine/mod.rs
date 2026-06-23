//! SOTA Query Engine - LightRAG-inspired implementation.
//!
//! # Implements
//!
//! - **FEAT0007**: Multi-Mode Query Execution
//! - **FEAT0101**: Naive Mode (vector search only)
//! - **FEAT0102**: Local Mode (entity-centric)
//! - **FEAT0103**: Global Mode (community summaries)
//! - **FEAT0104**: Hybrid Mode (local + global)
//! - **FEAT0105**: Mix Mode (adaptive blend)
//! - **FEAT0106**: Bypass Mode (direct LLM)
//! - **FEAT0107**: LLM-Based Keyword Extraction
//! - **FEAT0108**: Smart Context Truncation
//! - **FEAT0109**: SOTA Query Delegation
//!
//! # Enforces
//!
//! - **BR0101**: Token budget must not exceed LLM context window
//! - **BR0102**: Graph context takes priority over naive chunks
//! - **BR0103**: Query mode must be valid enum value
//! - **BR0104**: Conversation history included in context
//! - **BR0106**: Keyword cache TTL 24 hours default
//!
//! This module provides the enhanced query engine with:
//! - LLM-based keyword extraction with caching
//! - Mode-specific vector search (entities vs relationships)
//! - Batch graph operations
//! - Query caching
//!
//! # Architecture
//!
//! ```text
//! Query → Keyword Extraction → Mode Router
//!                                 ↓
//!         ┌───────────────────────┼───────────────────────┐
//!         ↓                       ↓                       ↓
//!     Local Mode             Global Mode             Naive Mode
//!   (Entity VDB +          (Relationship VDB +      (Chunk VDB)
//!    low-level kw)          high-level kw)
//!         ↓                       ↓                       ↓
//!         └───────────────────────┼───────────────────────┘
//!                                 ↓
//!                         Context Building
//!                                 ↓
//!                         Token Budgeting
//!                                 ↓
//!                         LLM Generation
//! ```
//!
//! # WHY: LightRAG Algorithm
//!
//! This implements the LightRAG paper's multi-level retrieval strategy:
//!
//! 1. **Keyword Extraction**: LLM extracts high-level (themes) and low-level
//!    (entities) keywords from the query. WHY: Different keywords retrieve
//!    different context types optimally.
//!
//! 2. **Mode-Specific Search**:
//!    - Local: Uses low-level keywords to find entity nodes
//!    - Global: Uses high-level keywords to find relationship clusters
//!    - Naive: Direct query embedding against chunk vectors
//!
//! 3. **Token Budgeting**: Context is truncated to fit LLM window while
//!    maintaining the most relevant information. Graph context is prioritized
//!    over raw chunks because graph relationships are pre-summarized.
//!
//! # See Also
//!
//! - [`QueryMode`] for available modes
//! - [`QueryRequest`] for query parameters
//! - [docs/features.md](../../../../../../docs/features.md) for feature details

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::{QueryError, Result};
use crate::keywords::{
    CachedKeywordExtractor, ExtractedKeywords, InMemoryKeywordCache, KeywordExtractor,
    LLMKeywordExtractor, MockKeywordExtractor,
};
use crate::modes::QueryMode;
use crate::tokenizer::{SimpleTokenizer, Tokenizer};
use crate::truncation::TruncationConfig;

use edgequake_llm::traits::{EmbeddingProvider, LLMProvider};
use edgequake_llm::Reranker;
use edgequake_storage::traits::{GraphStorage, VectorStorage};

/// Configuration for the SOTA query engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SOTAQueryConfig {
    /// Default query mode.
    pub default_mode: QueryMode,

    /// Maximum entities to retrieve.
    pub max_entities: usize,

    /// Maximum relationships to retrieve.
    pub max_relationships: usize,

    /// Maximum chunks to retrieve.
    pub max_chunks: usize,

    /// Maximum context tokens.
    pub max_context_tokens: usize,

    /// Graph traversal depth.
    pub graph_depth: usize,

    /// Minimum similarity score threshold.
    pub min_score: f32,

    /// Whether to use keyword extraction.
    pub use_keyword_extraction: bool,

    /// Whether to use adaptive mode selection based on query intent.
    pub use_adaptive_mode: bool,

    /// Truncation configuration.
    pub truncation: TruncationConfig,

    /// Keyword cache TTL in seconds.
    pub keyword_cache_ttl_secs: u64,

    /// Enable reranking for improved retrieval precision.
    pub enable_rerank: bool,

    /// Minimum rerank score threshold (0.0 - 1.0).
    pub min_rerank_score: f32,

    /// Top K results to keep after reranking.
    pub rerank_top_k: usize,

    // ── PPR (HippoRAG-2 multi-hop) — default-OFF experimental mode ──
    /// Enable `QueryMode::Ppr`. When false a ppr request is coerced to
    /// `default_mode`, so no ppr branch runs and other modes are byte-identical.
    #[serde(default)]
    pub ppr_enabled: bool,
    /// PPR restart/teleport probability (HippoRAG 0.15).
    #[serde(default = "default_ppr_alpha")]
    pub ppr_alpha: f32,
    /// PPR power-iteration cap.
    #[serde(default = "default_ppr_max_iter")]
    pub ppr_max_iter: usize,
    /// PPR L1 convergence threshold.
    #[serde(default = "default_ppr_epsilon")]
    pub ppr_epsilon: f32,
    /// Reciprocal Rank Fusion constant.
    #[serde(default = "default_ppr_rrf_k")]
    pub ppr_rrf_k: f32,
    /// Candidate pool size returned for the web visibility-aware top-up.
    #[serde(default = "default_ppr_candidate_pool")]
    pub ppr_candidate_pool: usize,
}

fn default_ppr_alpha() -> f32 {
    0.15
}
fn default_ppr_max_iter() -> usize {
    50
}
fn default_ppr_epsilon() -> f32 {
    1e-6
}
fn default_ppr_rrf_k() -> f32 {
    60.0
}
fn default_ppr_candidate_pool() -> usize {
    60
}

impl SOTAQueryConfig {
    /// Override PPR settings from `EQ_PPR_*` environment variables. Called once
    /// at engine construction. Keeps PPR opt-in: only `EQ_PPR_ENABLED=true`
    /// turns it on; the tunables fall back to the defaults above.
    pub fn apply_ppr_env(&mut self) {
        if let Ok(v) = std::env::var("EQ_PPR_ENABLED") {
            self.ppr_enabled = v.eq_ignore_ascii_case("true") || v == "1";
        }
        if let Some(v) = std::env::var("EQ_PPR_ALPHA").ok().and_then(|s| s.parse().ok()) {
            self.ppr_alpha = v;
        }
        if let Some(v) = std::env::var("EQ_PPR_MAX_ITER").ok().and_then(|s| s.parse().ok()) {
            self.ppr_max_iter = v;
        }
        if let Some(v) = std::env::var("EQ_PPR_EPSILON").ok().and_then(|s| s.parse().ok()) {
            self.ppr_epsilon = v;
        }
        if let Some(v) = std::env::var("EQ_PPR_RRF_K").ok().and_then(|s| s.parse().ok()) {
            self.ppr_rrf_k = v;
        }
        if let Some(v) = std::env::var("EQ_PPR_CANDIDATE_POOL").ok().and_then(|s| s.parse().ok()) {
            self.ppr_candidate_pool = v;
        }
    }
}

impl Default for SOTAQueryConfig {
    fn default() -> Self {
        Self {
            default_mode: QueryMode::Hybrid,
            // WHY 60: LightRAG uses top_k=60 entities. More entity candidates = more
            // chunk candidates from the KG path, directly improving recall.
            max_entities: 60,
            // WHY 60: Match entity count for balanced KG context.
            // LightRAG allocates max_relation_tokens=8000 for relations.
            max_relationships: 60,
            // WHY 20: LightRAG uses chunk_top_k=20. More text chunks = more direct
            // evidence for the LLM, improving both recall and correctness.
            max_chunks: 20,
            // WHY 30000: LightRAG uses max_total_tokens=30000. With gpt-4o-mini
            // having 128K context, 4000 tokens was throwing away ~87% of usable context.
            // 30000 tokens uses only 23% of the context window — safe and effective.
            max_context_tokens: 30000,
            graph_depth: 2,
            min_score: 0.1,
            use_keyword_extraction: true,
            use_adaptive_mode: true,
            // WHY derived from max_context_tokens: The truncation budget MUST match
            // the context token budget, otherwise the system fetches chunks it then
            // throws away. LightRAG splits: 50% entities, 50% relationships, chunks
            // fill the remainder. With 30K total: entities=10K, rels=10K, chunks=10K.
            truncation: TruncationConfig {
                max_entity_tokens: 10000,
                max_relation_tokens: 10000,
                max_total_tokens: 30000,
            },
            keyword_cache_ttl_secs: 24 * 60 * 60, // 24 hours
            enable_rerank: true,                  // Enable by default for SOTA quality
            // WHY 0.1: BM25 scores can be low for short documents or simple queries.
            // 0.3 was too aggressive and filtered out valid chunks. 0.1 matches min_score.
            min_rerank_score: 0.1,
            // WHY 20: Match max_chunks to keep all chunk candidates after reranking.
            rerank_top_k: 20,
            ppr_enabled: false,
            ppr_alpha: default_ppr_alpha(),
            ppr_max_iter: default_ppr_max_iter(),
            ppr_epsilon: default_ppr_epsilon(),
            ppr_rrf_k: default_ppr_rrf_k(),
            ppr_candidate_pool: default_ppr_candidate_pool(),
        }
    }
}

/// Query embeddings for different keyword levels.
///
/// LightRAG uses different embeddings for different modes:
/// - low_level: Entity search (Local mode)
/// - high_level: Relationship search (Global mode)
/// - query: Direct chunk search (Naive mode)
pub struct QueryEmbeddings {
    /// Original query embedding.
    pub query: Vec<f32>,

    /// High-level keywords embedding (for Global mode).
    pub high_level: Vec<f32>,

    /// Low-level keywords embedding (for Local mode).
    pub low_level: Vec<f32>,
}

impl QueryEmbeddings {
    /// Compute all embeddings in a single batch.
    pub async fn compute(
        query: &str,
        keywords: &ExtractedKeywords,
        embedder: &dyn EmbeddingProvider,
    ) -> Result<Self> {
        let high_level_text = if keywords.high_level.is_empty() {
            query.to_string()
        } else {
            keywords.high_level.join(", ")
        };

        let low_level_text = if keywords.low_level.is_empty() {
            query.to_string()
        } else {
            keywords.low_level.join(", ")
        };

        // Batch embed all three texts
        let texts = vec![query.to_string(), high_level_text, low_level_text];

        let embeddings = embedder.embed(&texts).await.map_err(QueryError::from)?;

        if embeddings.len() != 3 {
            return Err(QueryError::Internal(format!(
                "Expected 3 embeddings, got {}",
                embeddings.len()
            )));
        }

        Ok(Self {
            query: embeddings[0].clone(),
            high_level: embeddings[1].clone(),
            low_level: embeddings[2].clone(),
        })
    }

    /// Simple embedding (same for all levels).
    pub fn uniform(embedding: Vec<f32>) -> Self {
        Self {
            query: embedding.clone(),
            high_level: embedding.clone(),
            low_level: embedding,
        }
    }
}

pub struct SOTAQueryEngine {
    config: SOTAQueryConfig,
    vector_storage: Arc<dyn VectorStorage>,
    graph_storage: Arc<dyn GraphStorage>,
    embedding_provider: Arc<dyn EmbeddingProvider>,
    llm_provider: Arc<dyn LLMProvider>,
    keyword_extractor: Arc<dyn KeywordExtractor>,
    tokenizer: Arc<dyn Tokenizer>,
    /// Optional reranker for improved retrieval precision.
    reranker: Option<Arc<dyn Reranker>>,
    /// Cache for keyword validation (keyword -> exists_in_graph).
    /// WHY: Avoids repeated graph lookups for the same keywords.
    keyword_validation_cache: Arc<tokio::sync::RwLock<std::collections::HashMap<String, bool>>>,
}

impl SOTAQueryEngine {
    /// Create a new SOTA query engine.
    pub fn new(
        config: SOTAQueryConfig,
        vector_storage: Arc<dyn VectorStorage>,
        graph_storage: Arc<dyn GraphStorage>,
        embedding_provider: Arc<dyn EmbeddingProvider>,
        llm_provider: Arc<dyn LLMProvider>,
    ) -> Self {
        // PPR feature flag + tunables come from EQ_PPR_* env (default-OFF).
        let mut config = config;
        config.apply_ppr_env();
        // Create cached keyword extractor
        let base_extractor = Arc::new(LLMKeywordExtractor::new(llm_provider.clone()));
        let cache = Arc::new(InMemoryKeywordCache::new(1000));
        let keyword_extractor: Arc<dyn KeywordExtractor> = Arc::new(CachedKeywordExtractor::new(
            base_extractor,
            cache,
            std::time::Duration::from_secs(config.keyword_cache_ttl_secs),
        ));

        Self {
            config,
            vector_storage,
            graph_storage,
            embedding_provider,
            llm_provider,
            keyword_extractor,
            tokenizer: Arc::new(SimpleTokenizer),
            reranker: None, // No reranker by default
            keyword_validation_cache: Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
        }
    }

    /// Create with a reranker for improved retrieval precision.
    pub fn with_reranker(mut self, reranker: Arc<dyn Reranker>) -> Self {
        self.reranker = Some(reranker);
        self
    }

    /// Create with mock keyword extractor (for testing).
    pub fn with_mock_keywords(
        config: SOTAQueryConfig,
        vector_storage: Arc<dyn VectorStorage>,
        graph_storage: Arc<dyn GraphStorage>,
        embedding_provider: Arc<dyn EmbeddingProvider>,
        llm_provider: Arc<dyn LLMProvider>,
    ) -> Self {
        let keyword_extractor: Arc<dyn KeywordExtractor> = Arc::new(MockKeywordExtractor::new());

        Self {
            config,
            vector_storage,
            graph_storage,
            embedding_provider,
            llm_provider,
            keyword_extractor,
            tokenizer: Arc::new(SimpleTokenizer),
            reranker: None,
            keyword_validation_cache: Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
        }
    }

    /// Set a custom keyword extractor.
    pub fn with_keyword_extractor(mut self, extractor: Arc<dyn KeywordExtractor>) -> Self {
        self.keyword_extractor = extractor;
        self
    }

    /// Set a custom tokenizer.
    pub fn with_tokenizer(mut self, tokenizer: Arc<dyn Tokenizer>) -> Self {
        self.tokenizer = tokenizer;
        self
    }
}

impl SOTAQueryEngine {
    /// Get the query configuration.
    pub fn config(&self) -> &SOTAQueryConfig {
        &self.config
    }

    /// Resolve the experimental PPR mode against the feature flag. When PPR is
    /// disabled, a ppr request is coerced to the configured default mode so no
    /// ppr branch executes and existing modes stay byte-identical.
    pub(super) fn effective_mode(&self, mode: QueryMode) -> QueryMode {
        if mode == QueryMode::Ppr && !self.config.ppr_enabled {
            self.config.default_mode
        } else {
            mode
        }
    }
}

mod prompt;
mod query_entry;
mod query_modes;
mod reranking;
mod vector_queries;
mod query_ppr;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sota_config_default() {
        let config = SOTAQueryConfig::default();
        assert_eq!(config.default_mode, QueryMode::Hybrid);
        assert!(config.use_keyword_extraction);
        assert!(config.use_adaptive_mode);
    }

    #[test]
    fn test_query_embeddings_uniform() {
        let embedding = vec![1.0, 2.0, 3.0];
        let embeddings = QueryEmbeddings::uniform(embedding.clone());

        assert_eq!(embeddings.query, embedding);
        assert_eq!(embeddings.high_level, embedding);
        assert_eq!(embeddings.low_level, embedding);
    }
}
