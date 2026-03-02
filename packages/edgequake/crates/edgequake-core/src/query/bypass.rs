//! Bypass RAG: Direct LLM query with no retrieval step.

use crate::error::Result;
use crate::types::{QueryContext, QueryMode, QueryParams, QueryResult, QueryStats};

impl super::QueryEngine {
    /// Bypass RAG: Skip retrieval, direct LLM query.
    pub(super) async fn query_bypass(
        &self,
        query: &str,
        _params: &QueryParams,
    ) -> Result<QueryResult> {
        let generation_start = std::time::Instant::now();

        let prompt = format!(
            "Answer the following question to the best of your ability.\n\nQuestion: {}\n\nAnswer:",
            query
        );

        let response = self
            .llm
            .complete(&prompt)
            .await
            .map_err(|e| crate::error::Error::internal(format!("LLM error: {}", e)))?;

        let generation_time_ms = generation_start.elapsed().as_millis() as u64;

        Ok(QueryResult {
            response: response.content,
            mode: QueryMode::Bypass,
            context: QueryContext::default(),
            stats: QueryStats {
                retrieval_time_ms: 0,
                generation_time_ms,
                total_time_ms: 0,
                prompt_tokens: response.prompt_tokens,
                response_tokens: response.completion_tokens,
                ..Default::default()
            },
        })
    }
}
