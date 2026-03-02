//! Naive RAG: Simple vector similarity search on document chunks.

use crate::error::Result;
use crate::types::{ContextChunk, QueryContext, QueryMode, QueryParams, QueryResult, QueryStats};

impl super::QueryEngine {
    /// Naive RAG: Simple vector search on chunks.
    pub(super) async fn query_naive(
        &self,
        query: &str,
        params: &QueryParams,
    ) -> Result<QueryResult> {
        let retrieval_start = std::time::Instant::now();

        // 1. Embed query
        let query_embeddings = self
            .embedding
            .embed(&[query.to_string()])
            .await
            .map_err(|e| crate::error::Error::internal(format!("Embedding error: {}", e)))?;

        let query_embedding = query_embeddings
            .first()
            .ok_or_else(|| crate::error::Error::internal("No embedding generated"))?;

        // 2. Search vector store for chunks
        let search_results = self
            .vector_storage
            .query(query_embedding, params.top_k, None)
            .await
            .map_err(|e| crate::error::Error::internal(format!("Vector search error: {}", e)))?;

        let retrieval_time_ms = retrieval_start.elapsed().as_millis() as u64;

        // 3. Build context
        let mut context_chunks = Vec::new();
        let mut context_text = String::new();

        for result in search_results {
            // Filter by tenant/workspace
            if !self.matches_tenant(
                &result.metadata,
                params.tenant_id.as_deref(),
                params.workspace_id.as_deref(),
            ) {
                continue;
            }

            let id = result.id;
            let score = result.score;
            let metadata = result.metadata;

            // Filter by type (only chunks for naive mode)
            if metadata.get("type").and_then(|v| v.as_str()) != Some("chunk") {
                continue;
            }

            let content = metadata
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let doc_id = metadata
                .get("document_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Extract line number information from metadata if available
            let start_line = metadata
                .get("start_line")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize);

            let end_line = metadata
                .get("end_line")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize);

            let chunk_index = metadata
                .get("chunk_index")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize);

            context_chunks.push(ContextChunk {
                chunk_id: id.clone(),
                document_id: doc_id,
                content: content.clone(),
                score,
                start_line,
                end_line,
                chunk_index,
            });

            context_text.push_str(&format!("--- Chunk {} ---\n{}\n\n", id, content));
        }

        let generation_start = std::time::Instant::now();

        // 4. Generate response
        let prompt = format!(
            "Answer the following question based on the provided context.\n\nContext:\n{}\n\nQuestion: {}\n\nAnswer:",
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
            mode: QueryMode::Naive,
            context: QueryContext {
                chunks: context_chunks,
                ..Default::default()
            },
            stats: QueryStats {
                retrieval_time_ms,
                generation_time_ms,
                total_time_ms: 0, // Set by caller
                chunks_retrieved: context_text.len(),
                prompt_tokens: response.prompt_tokens,
                response_tokens: response.completion_tokens,
                ..Default::default()
            },
        })
    }
}
