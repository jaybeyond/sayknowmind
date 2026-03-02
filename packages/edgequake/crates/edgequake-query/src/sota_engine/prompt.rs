use std::collections::HashMap;
use std::sync::Arc;

use crate::context::QueryContext;
use crate::error::Result;

use super::SOTAQueryEngine;

impl SOTAQueryEngine {
    pub(super) fn matches_tenant_filter(
        &self,
        metadata: &serde_json::Value,
        tenant_id: &Option<String>,
        workspace_id: &Option<String>,
    ) -> bool {
        if tenant_id.is_none() && workspace_id.is_none() {
            return true;
        }

        if let Some(tid) = tenant_id {
            if let Some(meta_tid) = metadata.get("tenant_id").and_then(|v| v.as_str()) {
                if meta_tid != tid {
                    return false;
                }
            }
        }

        if let Some(wid) = workspace_id {
            if let Some(meta_wid) = metadata.get("workspace_id").and_then(|v| v.as_str()) {
                if meta_wid != wid {
                    return false;
                }
            }
        }

        true
    }

    /// Check if properties match tenant filter.
    pub(super) fn matches_tenant_filter_props(
        &self,
        properties: &HashMap<String, serde_json::Value>,
        tenant_id: &Option<String>,
        workspace_id: &Option<String>,
    ) -> bool {
        if tenant_id.is_none() && workspace_id.is_none() {
            return true;
        }

        if let Some(tid) = tenant_id {
            if let Some(prop_tid) = properties.get("tenant_id").and_then(|v| v.as_str()) {
                if prop_tid != tid {
                    return false;
                }
            }
        }

        if let Some(wid) = workspace_id {
            if let Some(prop_wid) = properties.get("workspace_id").and_then(|v| v.as_str()) {
                if prop_wid != wid {
                    return false;
                }
            }
        }

        true
    }

    /// Build prompt for LLM.
    ///
    /// WHY: The prompt is designed to maximize information extraction from available context.
    /// When comparing products where one term doesn't exist in the knowledge base, we still
    /// want to provide useful information about what IS available, rather than just saying
    /// "no information found."
    pub(super) fn build_prompt(&self, query: &str, context: &QueryContext) -> String {
        if context.is_empty() {
            return "I'm sorry, but I couldn't find any relevant information in my knowledge base to answer your question.".to_string();
        }

        let context_text = context.to_context_string();

        format!(
            r#"---Role---

You are an expert AI assistant specializing in synthesizing information from a provided knowledge base. Your primary function is to answer user queries accurately by ONLY using the information within the provided **Context**.

---Goal---

Generate a comprehensive, well-structured answer to the user query.
The answer must integrate relevant facts from the Knowledge Graph and Document Chunks found in the **Context**.

---Instructions---

1. Step-by-Step Reasoning:
  - Carefully determine the user's query intent to fully understand the information need.
  - Scrutinize both Knowledge Graph Data (Entities and Relationships) and Document Chunks in the **Context**. Identify and extract all pieces of information that are directly relevant to answering the user query.
  - Weave the extracted facts into a coherent and logical response. Your own knowledge must ONLY be used to formulate fluent sentences and connect ideas, NOT to introduce any external information.

2. Content & Grounding:
  - Strictly adhere to the provided context; DO NOT invent, assume, or infer any information not explicitly stated.
  - If the answer cannot be fully determined from the **Context**, state what information IS available and note what is missing. A partial answer with specific data is better than a generic "insufficient information" response.

3. Formatting & Language:
  - The response MUST be in the same language as the user query.
  - Use Markdown formatting for clarity (headings, bold text, bullet points).

---Context---

{context_text}

---User Query---

{query}"#
        )
    }

    /// Generate answer using LLM.
    ///
    /// If `llm_override` is provided, uses that provider instead of the default.
    /// This enables per-request provider selection (SPEC-032).
    pub(super) async fn generate_answer_with_provider(
        &self,
        query: &str,
        context: &QueryContext,
        llm_override: Option<&Arc<dyn crate::LLMProvider>>,
    ) -> Result<(String, usize)> {
        if context.is_empty() {
            return Ok((
                "I'm sorry, but I couldn't find any relevant information in my knowledge base to answer your question.".to_string(),
                0,
            ));
        }

        let prompt = self.build_prompt(query, context);

        // SPEC-032: Use override provider if provided, else default
        let response = if let Some(provider) = llm_override {
            provider.complete(&prompt).await?
        } else {
            self.llm_provider.complete(&prompt).await?
        };

        Ok((response.content, response.completion_tokens))
    }

    /// Generate answer using the default LLM.
    pub(super) async fn generate_answer(
        &self,
        query: &str,
        context: &QueryContext,
    ) -> Result<(String, usize)> {
        self.generate_answer_with_provider(query, context, None)
            .await
    }
}
