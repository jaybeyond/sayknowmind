// time 윈도우 type
export type TimeWindow = '1h' | '24h' | '7d' | '30d';

// model metrics
export interface ModelMetrics {
  model: string;
  requestCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  successRate: number;
  totalTokens: number;
  avgFeedbackScore: number;
  fallbackCount: number;
}

// time series data 포인트
export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

// pattern statistics
export interface PatternStats {
  pattern: string;
  count: number;
  successRate: number;
  avgLatencyMs: number;
}

// dashboard data
export interface DashboardData {
  summary: {
    totalRequests: number;
    avgLatencyMs: number;
    successRate: number;
    positiveRate: number;
  };
  modelMetrics: ModelMetrics[];
  timeSeriesData: TimeSeriesPoint[];
  topPatterns: PatternStats[];
}

// 대시보드 filter
export interface DashboardFilter {
  timeWindow: TimeWindow;
  userId?: string;
  model?: string;
}

// cost analysis
export interface CostAnalysis {
  totalTokens: number;
  estimatedCost: number;
  costByModel: {
    model: string;
    tokens: number;
    cost: number;
  }[];
  costTrend: TimeSeriesPoint[];
}

// fallback analysis
export interface FallbackAnalysis {
  totalFallbacks: number;
  fallbackRate: number;
  fallbacksByModel: {
    model: string;
    count: number;
    reasons: string[];
  }[];
  fallbackTrend: TimeSeriesPoint[];
}

// 이상 징after type
export type AnomalyType = 'HIGH_LATENCY' | 'HIGH_ERROR_RATE' | 'LOW_SATISFACTION';

// 이상 징after 심각도
export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH';

// 이상 징after
export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  model?: string;
  value: number;
  threshold: number;
  detectedAt: string;
}

// 집계 filter
export interface AggregateFilter {
  timeWindow: TimeWindow;
  userId?: string;
  sessionId?: string;
  model?: string;
}

// 집계된 메트릭
export interface AggregatedMetrics {
  timeWindow: TimeWindow;
  startTime: string;
  endTime: string;
  totalRequests: number;
  avgLatencyMs: number;
  successRate: number;
  totalTokens: number;
  tokenEfficiency: number;
}

// 사용자 pattern
export interface UserPatterns {
  userId: string;
  timeWindow: TimeWindow;
  preferredModel?: string;
  avgQueryLength: number;
  topQueryTypes: string[];
  peakUsageHours: number[];
}

// learning record
export interface LearningRecord {
  queryType: string;
  modelUsed: string;
  latencyMs: number;
  tokensUsed: number;
  success: boolean;
  feedbackScore?: number;
  features: QueryFeatures;
}

// query features
export interface QueryFeatures {
  hasCode: boolean;
  hasQuestion: boolean;
  language: string;
  length: number;
  keywords: string[];
}

// model recommendation
export interface ModelRecommendation {
  model: string;
  confidence: number;
  reason: string;
  alternatives: string[];
}

// feature recommendation
export interface FeatureRecommendation {
  enableSearch: boolean;
  enableThinking: boolean;
  confidence: number;
}

// learning result
export interface LearnResult {
  patternsLearned: number;
  modelsOptimized: number;
  confidence: number;
  timestamp: string;
}

// satisfaction analysis
export interface SatisfactionAnalysis {
  overallScore: number;
  byModel: {
    model: string;
    score: number;
    sampleSize: number;
  }[];
  trend: TimeSeriesPoint[];
  correlations: {
    factor: string;
    correlation: number;
  }[];
}

// ==================== Aggregation DTOs ====================

/**
 * 사용자 메트릭
 * per user 집계 data
 */
export interface UserMetrics {
  userId: string;
  timeWindow: TimeWindow;
  requestCount: number;
  avgLatencyMs: number;
  successRate: number;
  totalTokens: number;
  tokenEfficiency: number;
  preferredModel?: string;
  avgQueryLength: number;
  topQueryTypes: string[];
}

/**
 * 글로벌 메트릭
 * all 시스템 집계 data
 */
export interface GlobalMetrics {
  timeWindow: TimeWindow;
  startTime: string;
  endTime: string;
  totalRequests: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  successRate: number;
  totalTokens: number;
  tokenEfficiency: number;
  uniqueUsers: number;
  uniqueSessions: number;
  modelDistribution: { model: string; count: number; percentage: number }[];
}

/**
 * save aggregation 결과
 */
export interface AggregationSaveResult {
  key: string;
  ttlSeconds: number;
  success: boolean;
}
