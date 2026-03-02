//! PDF upload progress tracking methods for `PipelineState`.
//!
//! OODA-12: These methods provide queryable PDF upload progress storage.
//! Progress is stored in-memory and keyed by `track_id`.
//! This enables the `GET /api/v1/documents/pdf/:id/progress` endpoint.

use crate::progress::{PdfUploadProgress, PhaseError, PipelinePhase};

use super::PipelineState;

impl PipelineState {
    /// Start tracking a new PDF upload.
    ///
    /// Creates a new `PdfUploadProgress` entry with all 6 phases set to Pending.
    /// Call this when PDF processing begins.
    pub async fn start_pdf_progress(&self, track_id: &str, pdf_id: &str, filename: &str) {
        let progress = PdfUploadProgress::new(
            track_id.to_string(),
            pdf_id.to_string(),
            filename.to_string(),
        );
        let mut inner = self.inner.write().await;
        inner.pdf_progress.insert(track_id.to_string(), progress);
    }

    /// Get current progress for a PDF upload.
    ///
    /// Returns `None` if no progress exists for this `track_id` (either not started
    /// or already cleaned up).
    pub async fn get_pdf_progress(&self, track_id: &str) -> Option<PdfUploadProgress> {
        let inner = self.inner.read().await;
        inner.pdf_progress.get(track_id).cloned()
    }

    /// Start a phase with known total items.
    ///
    /// Use this when beginning a phase like `PdfConversion` with `total_pages`.
    pub async fn start_pdf_phase(&self, track_id: &str, phase: PipelinePhase, total: usize) {
        let mut inner = self.inner.write().await;
        if let Some(progress) = inner.pdf_progress.get_mut(track_id) {
            progress.start_phase(phase, total);
        }
    }

    /// Update progress for a phase.
    pub async fn update_pdf_phase(
        &self,
        track_id: &str,
        phase: PipelinePhase,
        current: usize,
        message: &str,
    ) {
        let mut inner = self.inner.write().await;
        if let Some(progress) = inner.pdf_progress.get_mut(track_id) {
            progress.update_phase(phase, current, message);
        }
    }

    /// Mark a phase as complete.
    pub async fn complete_pdf_phase(&self, track_id: &str, phase: PipelinePhase) {
        let mut inner = self.inner.write().await;
        if let Some(progress) = inner.pdf_progress.get_mut(track_id) {
            progress.complete_phase(phase);
        }
    }

    /// Mark a phase as failed.
    pub async fn fail_pdf_phase(&self, track_id: &str, phase: PipelinePhase, error: PhaseError) {
        let mut inner = self.inner.write().await;
        if let Some(progress) = inner.pdf_progress.get_mut(track_id) {
            progress.fail_phase(phase, error);
        }
    }

    /// Remove progress entry (for cleanup after completion).
    ///
    /// Call this after the entire pipeline completes to free memory.
    pub async fn remove_pdf_progress(&self, track_id: &str) {
        let mut inner = self.inner.write().await;
        inner.pdf_progress.remove(track_id);
    }

    /// Get all active PDF progress entries (for admin/monitoring).
    pub async fn list_pdf_progress(&self) -> Vec<PdfUploadProgress> {
        let inner = self.inner.read().await;
        inner.pdf_progress.values().cloned().collect()
    }
}
