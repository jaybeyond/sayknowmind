//! Default value functions for serde deserialization.
//!
//! These functions provide default values for request fields when
//! not specified in the incoming JSON. Used via `#[serde(default = "...")]`.

/// Default: enable gleaning for higher quality entity extraction.
pub fn default_enable_gleaning() -> bool {
    true
}

/// Default: 1 gleaning pass.
pub fn default_max_gleaning() -> usize {
    1
}

/// Default: enable LLM-powered description summarization.
pub fn default_use_llm_summarization() -> bool {
    true
}

/// Default: page 1 (1-indexed).
pub fn default_page() -> usize {
    1
}

/// Default: 20 items per page.
pub fn default_page_size() -> usize {
    20
}

/// Default: scan subdirectories recursively.
pub fn default_recursive() -> bool {
    true
}

/// Default: max 1000 files per scan.
pub fn default_max_files() -> usize {
    1000
}

/// Default true value for document-related boolean fields.
pub fn documents_default_true() -> bool {
    true
}

/// Default: max 100 documents to reprocess.
pub fn default_max_reprocess() -> usize {
    100
}

/// Default: 10 minutes before considering a document stuck.
pub fn default_stuck_threshold_minutes() -> u64 {
    10
}

/// Default maximum retry attempts for chunks.
pub fn default_max_chunk_retries() -> usize {
    3
}
