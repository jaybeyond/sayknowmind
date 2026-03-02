//! Naive query strategy — pure vector similarity search.

use std::sync::Arc;

use async_trait::async_trait;

use super::config::{QueryStrategy, StrategyConfig};
use crate::context::{QueryContext, RetrievedChunk};
use crate::error::Result;
use crate::modes::QueryMode;

use edgequake_storage::traits::VectorStorage;

/// Naive query strategy - pure vector similarity search.
pub struct NaiveStrategy<V: VectorStorage> {
    pub(super) vector_storage: Arc<V>,
}

impl<V: VectorStorage> NaiveStrategy<V> {
    /// Create a new naive strategy.
    pub fn new(vector_storage: Arc<V>) -> Self {
        Self { vector_storage }
    }
}

#[async_trait]
impl<V: VectorStorage> QueryStrategy for NaiveStrategy<V> {
    async fn execute(
        &self,
        _query: &str,
        query_embedding: &[f32],
        config: &StrategyConfig,
    ) -> Result<QueryContext> {
        let mut context = QueryContext::new();

        // Simple vector similarity search
        let results = self
            .vector_storage
            .query(query_embedding, config.max_chunks, None)
            .await?;

        for result in results {
            if result.score >= config.min_score {
                let content = result
                    .metadata
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                context.add_chunk(RetrievedChunk::new(&result.id, content, result.score));
            }
        }

        Ok(context)
    }

    fn mode(&self) -> QueryMode {
        QueryMode::Naive
    }
}
