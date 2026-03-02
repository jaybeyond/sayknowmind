//! Task progress tracking types.
//!
//! Provides step-level and chunk-level progress tracking
//! for document processing pipelines.

use serde::{Deserialize, Serialize};

/// Step-level progress for a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskProgress {
    pub current_step: String,
    pub total_steps: u32,
    pub percent_complete: u8,

    /// Chunk-level progress for document processing.
    ///
    /// @implements SPEC-001/Objective-A: Chunk-Level Progress Visibility
    ///
    /// WHY: The real progression of document ingestion is chunks processed
    /// vs chunks remaining. This field provides granular visibility into
    /// the map-reduce extraction phase where each chunk is processed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_progress: Option<ChunkProgress>,
}

/// Chunk-level progress tracking for a document being processed.
///
/// @implements SPEC-001/Objective-A: Chunk-Level Progress Visibility
///
/// WHY: After chunking, documents go through a MAP-REDUCE extraction phase:
/// - MAP: Each chunk → LLM extraction + embedding generation
/// - REDUCE: Merge entities, deduplicate, build relationships
///
/// This struct tracks the MAP phase progress at chunk granularity.
///
/// ```text
/// ┌──────────────────────────────────────────────────────────────┐
/// │ CHUNK PROGRESS VISUALIZATION                                 │
/// ├──────────────────────────────────────────────────────────────┤
/// │ Chunks: [████████████░░░░░░░░░░░░░░░░░░] 12/35 (34%)        │
/// │ Current: Chunk 12 - "Section 3.2: Methodology..."            │
/// │ Avg time/chunk: 2.3s | ETA: ~53s remaining                   │
/// │ Tokens: 45,230 in / 8,450 out | Cost: $0.0089               │
/// └──────────────────────────────────────────────────────────────┘
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkProgress {
    /// Total number of chunks in the document.
    pub total_chunks: u32,

    /// Number of chunks fully processed (extracted + embedded).
    pub processed_chunks: u32,

    /// Current chunk index being processed (0-based).
    pub current_chunk_index: u32,

    /// Preview of current chunk content (first 80 chars, truncated).
    pub current_chunk_preview: String,

    /// Average time to process a single chunk (milliseconds).
    pub avg_chunk_time_ms: f64,

    /// Estimated time remaining (seconds).
    pub eta_seconds: u64,

    /// Total input tokens consumed so far.
    pub tokens_in: u64,

    /// Total output tokens consumed so far.
    pub tokens_out: u64,

    /// Running cost estimate (USD).
    pub cost_usd: f64,
}

impl ChunkProgress {
    /// Create a new ChunkProgress at the start of processing.
    pub fn new(total_chunks: u32) -> Self {
        Self {
            total_chunks,
            processed_chunks: 0,
            current_chunk_index: 0,
            current_chunk_preview: String::new(),
            avg_chunk_time_ms: 0.0,
            eta_seconds: 0,
            tokens_in: 0,
            tokens_out: 0,
            cost_usd: 0.0,
        }
    }

    /// Update progress after processing a chunk.
    pub fn update(
        &mut self,
        chunk_index: u32,
        chunk_preview: &str,
        elapsed_ms: u64,
        input_tokens: u64,
        output_tokens: u64,
        chunk_cost: f64,
    ) {
        self.processed_chunks = chunk_index + 1;
        self.current_chunk_index = chunk_index;
        self.current_chunk_preview = truncate_preview(chunk_preview, 80);
        self.tokens_in += input_tokens;
        self.tokens_out += output_tokens;
        self.cost_usd += chunk_cost;

        // Calculate running average time per chunk
        if self.processed_chunks > 0 {
            // Exponential moving average for smoother ETA
            let alpha = 0.3;
            if self.avg_chunk_time_ms == 0.0 {
                self.avg_chunk_time_ms = elapsed_ms as f64;
            } else {
                self.avg_chunk_time_ms =
                    alpha * (elapsed_ms as f64) + (1.0 - alpha) * self.avg_chunk_time_ms;
            }

            // Calculate ETA
            let remaining = self.total_chunks.saturating_sub(self.processed_chunks);
            self.eta_seconds = ((remaining as f64 * self.avg_chunk_time_ms) / 1000.0) as u64;
        }
    }

    /// Get completion percentage (0-100).
    pub fn percent_complete(&self) -> u8 {
        if self.total_chunks == 0 {
            return 0;
        }
        ((self.processed_chunks as f64 / self.total_chunks as f64) * 100.0) as u8
    }
}

/// Truncate a string to max_len characters, adding "..." if truncated.
fn truncate_preview(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        // Find a safe UTF-8 boundary
        let mut end = max_len.saturating_sub(3);
        while !s.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}...", &s[..end])
    }
}
