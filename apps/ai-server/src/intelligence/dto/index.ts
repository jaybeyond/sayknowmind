// Span DTOs
export {
  SpanType,
  SpanStatus,
  Span,
  CreateSpanDto,
  UpdateSpanDto,
  SpanFilter,
  StartSpanOptions,
  SpanResult,
  QueryFeatures,
  LearningRecord,
  QueryType,
} from './span.dto';

// Feedback DTOs
export * from './feedback.dto';

// Analytics DTOs - exclude duplicates from span.dto
export {
  TimeWindow,
  ModelMetrics,
  TimeSeriesPoint,
  PatternStats,
  DashboardData,
  DashboardFilter,
  CostAnalysis,
  FallbackAnalysis,
  AnomalyType,
  AnomalySeverity,
  Anomaly,
  AggregateFilter,
  AggregatedMetrics,
  UserPatterns,
  SatisfactionAnalysis,
  UserMetrics,
  GlobalMetrics,
  AggregationSaveResult,
} from './analytics.dto';

// Algorithm DTOs - exclude duplicates
export {
  QueryContext,
  LearnedPattern,
  FeedbackWithSpan,
} from './algorithm.dto';

// Re-export ModelRecommendation, FeatureRecommendation, LearnResult from algorithm.dto
// (they have different structure than analytics.dto versions)
export type { ModelRecommendation, FeatureRecommendation, LearnResult } from './algorithm.dto';
