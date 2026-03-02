//! Metrics types: trigger classification and periodic snapshots.

use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

/// Describes what triggered a metrics collection.
///
/// WHY three variants: Supports event-driven (document ingestion),
/// cron-like (periodic health checks), and on-demand (admin dashboard)
/// metrics collection patterns.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MetricsTriggerType {
    /// Triggered by a specific event (e.g., document ingestion completed).
    Event,
    /// Triggered by a scheduled interval (e.g., every 5 minutes).
    Scheduled,
    /// Triggered manually (e.g., admin dashboard refresh).
    Manual,
}

impl MetricsTriggerType {
    /// Convert to a stable string for storage.
    pub fn as_str(&self) -> &'static str {
        match self {
            MetricsTriggerType::Event => "event",
            MetricsTriggerType::Scheduled => "scheduled",
            MetricsTriggerType::Manual => "manual",
        }
    }

    /// Parse from a string (case-insensitive).
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "event" => Some(MetricsTriggerType::Event),
            "scheduled" => Some(MetricsTriggerType::Scheduled),
            "manual" => Some(MetricsTriggerType::Manual),
            _ => None,
        }
    }
}

impl fmt::Display for MetricsTriggerType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// A point-in-time snapshot of workspace metrics.
///
/// WHY separate from WorkspaceStats: Snapshots are timestamped records
/// for trend analysis, while WorkspaceStats is the current state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsSnapshot {
    /// Unique snapshot ID.
    pub id: Uuid,
    /// Workspace this snapshot belongs to.
    pub workspace_id: Uuid,
    /// When the snapshot was recorded.
    pub recorded_at: chrono::DateTime<chrono::Utc>,
    /// What triggered this snapshot.
    pub trigger_type: MetricsTriggerType,
    /// Document count at snapshot time.
    pub document_count: usize,
    /// Chunk count at snapshot time.
    pub chunk_count: usize,
    /// Entity count at snapshot time.
    pub entity_count: usize,
    /// Relationship count at snapshot time.
    pub relationship_count: usize,
    /// Embedding count at snapshot time.
    pub embedding_count: usize,
    /// Storage used in bytes at snapshot time.
    pub storage_bytes: usize,
}
