import { Injectable, Logger } from '@nestjs/common';
import { SpanService } from './span.service';
import { AdapterService } from './adapter.service';
import { FeedbackService } from './feedback.service';
import {
  TimeWindow,
  ModelMetrics,
  DashboardData,
  DashboardFilter,
  TimeSeriesPoint,
  PatternStats,
  CostAnalysis,
  FallbackAnalysis,
  Anomaly,
  AnomalyType,
  AnomalySeverity,
} from './dto/analytics.dto';

/**
 * Analytics Service
 * 
 * Provides model performance analysis and dashboard data.
 * 
 * Requirements: 6.1, 6.2, 6.4, 6.5, 6.6
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  /**
   * Convert time window to milliseconds
   */
  private readonly TIME_WINDOW_MS: Record<TimeWindow, number> = {
    '1h': 60 * 60 * 1000,           // 1 hour = 3600000 ms
    '24h': 24 * 60 * 60 * 1000,     // 24 hours = 86400000 ms
    '7d': 7 * 24 * 60 * 60 * 1000,  // 7 days = 604800000 ms
    '30d': 30 * 24 * 60 * 60 * 1000, // 30 days = 2592000000 ms
  };

  // Token pricing per model (per 1M tokens)
  // Based on design document pricing
  private readonly TOKEN_PRICING: Record<string, number> = {
    'solar-pro': 0.50,
    'solar-pro-3': 0.50,
    'step-3.5-flash': 0.30,
    'qwen3-next-80b': 0.40,
    'glm-4.7': 0.35,
    'glm-4.5-air': 0.35,
    'gemini-2.5-flash': 0.25,
    'gemma-3-27b': 0.25,
    'llama-3.1-70b': 0.30,
  };

  /**
   * Default token price (for unknown models)
   */
  private readonly DEFAULT_TOKEN_PRICE = 0.30;

  /**
   * Anomaly detection thresholds
   */
  private readonly ANOMALY_THRESHOLDS = {
    HIGH_LATENCY: 2000,        // High latency if > 2000ms
    HIGH_ERROR_RATE: 0.9,      // High error rate if success rate < 90%
    LOW_SATISFACTION: 0.6,     // Low satisfaction if feedback score < 0.6
  };

  constructor(
    private readonly spanService: SpanService,
    private readonly adapterService: AdapterService,
    private readonly feedbackService: FeedbackService,
  ) {}

  /**
   * Cost analysis
   * 
   * Calculates token usage and estimated cost by model.
   * 
   * @param timeWindow Time window ('1h' | '24h' | '7d' | '30d')
   * @param userId Optional user ID
   * @returns Cost analysis result
   * 
   * Requirements: 6.4
   * Validates: Property 21 - Cost calculation accuracy
   */
  async getCostAnalysis(timeWindow: TimeWindow, userId?: string): Promise<CostAnalysis> {
    this.logger.debug(`Getting cost analysis for timeWindow: ${timeWindow}, userId: ${userId || 'all'}`);

    try {
      // Get metrics by model
      const modelMetrics = await this.getModelMetrics(timeWindow, userId);

      // Calculate cost by model
      const costByModel = modelMetrics.map(metrics => {
        const pricePerMillion = this.getTokenPrice(metrics.model);
        const cost = (metrics.totalTokens / 1_000_000) * pricePerMillion;
        
        return {
          model: metrics.model,
          tokens: metrics.totalTokens,
          cost: Math.round(cost * 10000) / 10000, // 4 decimal places
        };
      });

      // Calculate total tokens and cost
      const totalTokens = costByModel.reduce((sum, item) => sum + item.tokens, 0);
      const estimatedCost = costByModel.reduce((sum, item) => sum + item.cost, 0);

      // Generate cost trend
      const { startTime, endTime } = this.getTimeRange(timeWindow);
      const costTrend = await this.generateCostTrend(timeWindow, startTime, endTime, userId);

      const result: CostAnalysis = {
        totalTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
        costByModel,
        costTrend,
      };

      this.logger.debug(`Cost analysis: totalTokens=${totalTokens}, estimatedCost=$${estimatedCost.toFixed(4)}`);
      return result;
    } catch (error) {
      this.logger.error(`Error getting cost analysis: ${error.message}`);
      return this.createEmptyCostAnalysis();
    }
  }

  /**
   * Analyze fallback frequency and causes.
   */
  async getFallbackAnalysis(timeWindow: TimeWindow, userId?: string): Promise<FallbackAnalysis> {
    this.logger.debug(`Getting fallback analysis for timeWindow: ${timeWindow}, userId: ${userId || 'all'}`);

    try {
      // Get metrics by model
      const modelMetrics = await this.getModelMetrics(timeWindow, userId);

      // Calculate total requests
      const totalRequests = modelMetrics.reduce((sum, m) => sum + m.requestCount, 0);

      // Analyze fallbacks by model
      const fallbacksByModel = modelMetrics
        .filter(m => m.fallbackCount > 0)
        .map(metrics => ({
          model: metrics.model,
          count: metrics.fallbackCount,
          reasons: this.inferFallbackReasons(metrics),
        }));

      // Calculate total fallbacks (sum of counts in fallbacksByModel)
      const totalFallbacks = fallbacksByModel.reduce((sum, item) => sum + item.count, 0);

      // Calculate fallback rate (totalFallbacks / totalRequests)
      const fallbackRate = totalRequests > 0
        ? Math.round((totalFallbacks / totalRequests) * 10000) / 10000
        : 0;

      // Generate fallback trend
      const { startTime, endTime } = this.getTimeRange(timeWindow);
      const fallbackTrend = await this.generateFallbackTrend(timeWindow, startTime, endTime, userId);

      const result: FallbackAnalysis = {
        totalFallbacks,
        fallbackRate,
        fallbacksByModel,
        fallbackTrend,
      };

      this.logger.debug(`Fallback analysis: totalFallbacks=${totalFallbacks}, fallbackRate=${(fallbackRate * 100).toFixed(2)}%`);
      return result;
    } catch (error) {
      this.logger.warn(`Error getting fallback analysis (Redis may be unavailable): ${error.message}`);
      return this.createEmptyFallbackAnalysis(); // Don't throw error (Requirements 8.6)
    }
  }

  /**
   * Detect anomalies
   * 
   * Detects performance anomalies by model.
   * - HIGH_LATENCY: Average latency > 2000ms
   * - HIGH_ERROR_RATE: Success rate < 90%
   * - LOW_SATISFACTION: Feedback score < 0.6
   * 
   * Returns empty array even on Redis failure. (Requirements 8.6)
   * 
   * @param userId Optional user ID
   * @returns List of detected anomalies
   * 
   * Requirements: 6.6, 8.6
   * Validates: Property 23 - Anomaly warning thresholds
   * Validates: Property 29 - Service continuity on Redis failure
   */
  async detectAnomalies(userId?: string): Promise<Anomaly[]> {
    this.logger.debug(`Detecting anomalies for userId: ${userId || 'all'}`);

    try {
      // Get recent 24-hour model metrics
      const modelMetrics = await this.getModelMetrics('24h', userId);
      const anomalies: Anomaly[] = [];
      const detectedAt = new Date().toISOString();

      for (const metrics of modelMetrics) {
        // Skip models with no requests
        if (metrics.requestCount === 0) continue;

        // Detect HIGH_LATENCY
        if (metrics.avgLatencyMs > this.ANOMALY_THRESHOLDS.HIGH_LATENCY) {
          const severity = this.calculateSeverity(
            metrics.avgLatencyMs,
            this.ANOMALY_THRESHOLDS.HIGH_LATENCY,
            'higher',
          );
          anomalies.push({
            type: 'HIGH_LATENCY',
            severity,
            model: metrics.model,
            value: metrics.avgLatencyMs,
            threshold: this.ANOMALY_THRESHOLDS.HIGH_LATENCY,
            detectedAt,
          });
        }

        // Detect HIGH_ERROR_RATE (success rate below threshold)
        if (metrics.successRate < this.ANOMALY_THRESHOLDS.HIGH_ERROR_RATE) {
          const severity = this.calculateSeverity(
            metrics.successRate,
            this.ANOMALY_THRESHOLDS.HIGH_ERROR_RATE,
            'lower',
          );
          anomalies.push({
            type: 'HIGH_ERROR_RATE',
            severity,
            model: metrics.model,
            value: metrics.successRate,
            threshold: this.ANOMALY_THRESHOLDS.HIGH_ERROR_RATE,
            detectedAt,
          });
        }

        // Detect LOW_SATISFACTION (feedback score exists and below threshold)
        if (metrics.avgFeedbackScore > 0 && metrics.avgFeedbackScore < this.ANOMALY_THRESHOLDS.LOW_SATISFACTION) {
          const severity = this.calculateSeverity(
            metrics.avgFeedbackScore,
            this.ANOMALY_THRESHOLDS.LOW_SATISFACTION,
            'lower',
          );
          anomalies.push({
            type: 'LOW_SATISFACTION',
            severity,
            model: metrics.model,
            value: metrics.avgFeedbackScore,
            threshold: this.ANOMALY_THRESHOLDS.LOW_SATISFACTION,
            detectedAt,
          });
        }
      }

      this.logger.debug(`Detected ${anomalies.length} anomalies`);
      return anomalies;
    } catch (error) {
      this.logger.warn(`Error detecting anomalies (Redis may be unavailable): ${error.message}`);
      return []; // Don't throw error (Requirements 8.6)
    }
  }

  /**
   * Get real-time metrics by model
   */
  async getModelMetrics(timeWindow: TimeWindow, userId?: string): Promise<ModelMetrics[]> {
    this.logger.debug(`Getting model metrics for timeWindow: ${timeWindow}, userId: ${userId || 'all'}`);

    try {
      // AdapterService's aggregateByModel
      const modelMetrics = await this.adapterService.aggregateByModel(timeWindow, userId);

      // Validate all required fields exist and set defaults
      const validatedMetrics = modelMetrics.map(metrics => this.validateModelMetrics(metrics));

      this.logger.debug(`Retrieved ${validatedMetrics.length} model metrics`);
      return validatedMetrics;
    } catch (error) {
      this.logger.warn(`Error getting model metrics (Redis may be unavailable): ${error.message}`);
      return []; // Don't throw error (Requirements 8.6)
    }
  }

  /**
   * Get dashboard data
   * 
   * @param filter Dashboard filter (timeWindow, userId, model)
   * @returns Dashboard data
   * 
   * Requirements: 6.2, 8.6
   * Validates: Property 20 - Dashboard time range filtering
   * Validates: Property 29 - Service continuity on Redis failure
   */
  async getDashboardData(filter: DashboardFilter): Promise<DashboardData> {
    const { timeWindow, userId, model } = filter;
    this.logger.debug(`Getting dashboard data for filter: ${JSON.stringify(filter)}`);

    try {
      // Calculate time range
      const { startTime, endTime } = this.getTimeRange(timeWindow);

      // Get model metrics
      let modelMetrics = await this.getModelMetrics(timeWindow, userId);

      // Apply model filter
      if (model) {
        modelMetrics = modelMetrics.filter(m => m.model === model);
      }

      // Calculate summary statistics
      const summary = this.calculateSummary(modelMetrics, userId, timeWindow);

      // Generate time series data
      const timeSeriesData = await this.generateTimeSeriesData(
        timeWindow,
        userId,
        startTime,
        endTime,
      );

      // 4. Get top patterns
      const topPatterns = await this.getTopPatterns(timeWindow, userId);

      const dashboardData: DashboardData = {
        summary,
        modelMetrics,
        timeSeriesData,
        topPatterns,
      };

      this.logger.debug(`Dashboard data generated with ${modelMetrics.length} models, ${timeSeriesData.length} time series points`);
      return dashboardData;
    } catch (error) {
      this.logger.warn(`Error getting dashboard data (Redis may be unavailable): ${error.message}`);
      return this.createEmptyDashboardData(); // Don't throw error (Requirements 8.6)
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Calculate time range based on time window
   */
  private getTimeRange(timeWindow: TimeWindow): { startTime: Date; endTime: Date } {
    const now = new Date();
    const endTime = now;
    const startTime = new Date(now.getTime() - this.TIME_WINDOW_MS[timeWindow]);

    return { startTime, endTime };
  }

  /**
   * Validate ModelMetrics required fields and set defaults
   */
  private validateModelMetrics(metrics: Partial<ModelMetrics>): ModelMetrics {
    return {
      model: metrics.model || 'unknown',
      requestCount: metrics.requestCount ?? 0,
      avgLatencyMs: metrics.avgLatencyMs ?? 0,
      p95LatencyMs: metrics.p95LatencyMs ?? 0,
      successRate: metrics.successRate ?? 0,
      totalTokens: metrics.totalTokens ?? 0,
      avgFeedbackScore: metrics.avgFeedbackScore ?? 0,
      fallbackCount: metrics.fallbackCount ?? 0,
    };
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(
    modelMetrics: ModelMetrics[],
    userId?: string,
    timeWindow?: TimeWindow,
  ): DashboardData['summary'] {
    if (modelMetrics.length === 0) {
      return {
        totalRequests: 0,
        avgLatencyMs: 0,
        successRate: 0,
        positiveRate: 0,
      };
    }

    // Total requests
    const totalRequests = modelMetrics.reduce((sum, m) => sum + m.requestCount, 0);

    // Weighted average latency (by request count)
    const totalLatencyWeighted = modelMetrics.reduce(
      (sum, m) => sum + m.avgLatencyMs * m.requestCount,
      0,
    );
    const avgLatencyMs = totalRequests > 0
      ? Math.round((totalLatencyWeighted / totalRequests) * 100) / 100
      : 0;

    // Weighted average success rate (by request count)
    const totalSuccessWeighted = modelMetrics.reduce(
      (sum, m) => sum + m.successRate * m.requestCount,
      0,
    );
    const successRate = totalRequests > 0
      ? Math.round((totalSuccessWeighted / totalRequests) * 10000) / 10000
      : 0;

    // Positive feedback rate (based on feedback score)
    const feedbackScores = modelMetrics
      .filter(m => m.avgFeedbackScore > 0)
      .map(m => ({ score: m.avgFeedbackScore, count: m.requestCount }));
    
    let positiveRate = 0;
    if (feedbackScores.length > 0) {
      const totalFeedbackWeighted = feedbackScores.reduce(
        (sum, f) => sum + f.score * f.count,
        0,
      );
      const totalFeedbackCount = feedbackScores.reduce((sum, f) => sum + f.count, 0);
      positiveRate = totalFeedbackCount > 0
        ? Math.round((totalFeedbackWeighted / totalFeedbackCount) * 10000) / 10000
        : 0;
    }

    return {
      totalRequests,
      avgLatencyMs,
      successRate,
      positiveRate,
    };
  }

  /**
   * Generate time series data
   * 
   * Validates: Property 20 - Dashboard time range filtering
   */
  private async generateTimeSeriesData(
    timeWindow: TimeWindow,
    userId: string | undefined,
    startTime: Date,
    endTime: Date,
  ): Promise<TimeSeriesPoint[]> {
    // Determine interval based on time window
    const intervals = this.getTimeSeriesIntervals(timeWindow);
    const intervalMs = this.TIME_WINDOW_MS[timeWindow] / intervals;

    const timeSeriesData: TimeSeriesPoint[] = [];

    // Generate data point for each interval
    for (let i = 0; i < intervals; i++) {
      const intervalStart = new Date(startTime.getTime() + i * intervalMs);
      const intervalEnd = new Date(startTime.getTime() + (i + 1) * intervalMs);

      // Calculate request count for this interval (0 if no actual data)
      // In actual implementation, query Span data to calculate
      const value = 0; // Default, update when querying actual data

      // Check if timestamp is within time range
      const timestamp = intervalStart.toISOString();
      if (intervalStart >= startTime && intervalStart <= endTime) {
        timeSeriesData.push({
          timestamp,
          value,
        });
      }
    }

    return timeSeriesData;
  }

  /**
   * Determine number of time series intervals based on time window
   */
  private getTimeSeriesIntervals(timeWindow: TimeWindow): number {
    switch (timeWindow) {
      case '1h':
        return 12;  // 5-minute intervals
      case '24h':
        return 24;  // 1-hour intervals
      case '7d':
        return 28;  // 6-hour intervals
      case '30d':
        return 30;  // 1-day intervals
      default:
        return 24;
    }
  }

  /**
   * Get top patterns
   */
  private async getTopPatterns(
    timeWindow: TimeWindow,
    userId?: string,
  ): Promise<PatternStats[]> {
    // Return default pattern statistics
    // In actual implementation, analyze Span data to extract patterns
    const defaultPatterns: PatternStats[] = [
      {
        pattern: 'general',
        count: 0,
        successRate: 0,
        avgLatencyMs: 0,
      },
      {
        pattern: 'code',
        count: 0,
        successRate: 0,
        avgLatencyMs: 0,
      },
      {
        pattern: 'search',
        count: 0,
        successRate: 0,
        avgLatencyMs: 0,
      },
    ];

    return defaultPatterns;
  }

  /**
   * Create empty dashboard data
   */
  private createEmptyDashboardData(): DashboardData {
    return {
      summary: {
        totalRequests: 0,
        avgLatencyMs: 0,
        successRate: 0,
        positiveRate: 0,
      },
      modelMetrics: [],
      timeSeriesData: [],
      topPatterns: [],
    };
  }

  // ==================== Cost Analysis Helper Methods ====================

  /**
   * Get token price by model
   * 
   * @param model Model name
   * @returns Price per 1M tokens (USD)
   */
  private getTokenPrice(model: string): number {
    // Normalize model name (lowercase, remove spaces)
    const normalizedModel = model.toLowerCase().replace(/\s+/g, '-');
    
    // Try exact match
    if (this.TOKEN_PRICING[normalizedModel]) {
      return this.TOKEN_PRICING[normalizedModel];
    }

    // Try partial match
    for (const [key, price] of Object.entries(this.TOKEN_PRICING)) {
      if (normalizedModel.includes(key) || key.includes(normalizedModel)) {
        return price;
      }
    }

    // Return default price
    return this.DEFAULT_TOKEN_PRICE;
  }

  /**
   * Generate cost trend
   */
  private async generateCostTrend(
    timeWindow: TimeWindow,
    startTime: Date,
    endTime: Date,
    userId?: string,
  ): Promise<TimeSeriesPoint[]> {
    const intervals = this.getTimeSeriesIntervals(timeWindow);
    const intervalMs = this.TIME_WINDOW_MS[timeWindow] / intervals;
    const costTrend: TimeSeriesPoint[] = [];

    for (let i = 0; i < intervals; i++) {
      const intervalStart = new Date(startTime.getTime() + i * intervalMs);
      
      if (intervalStart >= startTime && intervalStart <= endTime) {
        costTrend.push({
          timestamp: intervalStart.toISOString(),
          value: 0, // In actual implementation, calculate cost for this interval
        });
      }
    }

    return costTrend;
  }

  /**
   * Create empty cost analysis result
   */
  private createEmptyCostAnalysis(): CostAnalysis {
    return {
      totalTokens: 0,
      estimatedCost: 0,
      costByModel: [],
      costTrend: [],
    };
  }

  // ==================== Fallback Analysis Helper Methods ====================

  /**
   * Infer fallback reasons
   */
  private inferFallbackReasons(metrics: ModelMetrics): string[] {
    const reasons: string[] = [];

    // Timeout due to high latency
    if (metrics.avgLatencyMs > 5000) {
      reasons.push('TIMEOUT');
    }

    // Error due to low success rate
    if (metrics.successRate < 0.8) {
      reasons.push('ERROR_RATE');
    }

    // Default reason
    if (reasons.length === 0) {
      reasons.push('RATE_LIMIT');
    }

    return reasons;
  }

  /**
   * Generate fallback trend
   */
  private async generateFallbackTrend(
    timeWindow: TimeWindow,
    startTime: Date,
    endTime: Date,
    userId?: string,
  ): Promise<TimeSeriesPoint[]> {
    const intervals = this.getTimeSeriesIntervals(timeWindow);
    const intervalMs = this.TIME_WINDOW_MS[timeWindow] / intervals;
    const fallbackTrend: TimeSeriesPoint[] = [];

    for (let i = 0; i < intervals; i++) {
      const intervalStart = new Date(startTime.getTime() + i * intervalMs);
      
      if (intervalStart >= startTime && intervalStart <= endTime) {
        fallbackTrend.push({
          timestamp: intervalStart.toISOString(),
          value: 0, // In actual implementation, calculate fallback count for this interval
        });
      }
    }

    return fallbackTrend;
  }

  /**
   * Create empty fallback analysis result
   */
  private createEmptyFallbackAnalysis(): FallbackAnalysis {
    return {
      totalFallbacks: 0,
      fallbackRate: 0,
      fallbacksByModel: [],
      fallbackTrend: [],
    };
  }

  // ==================== Anomaly Detection Helper Methods ====================

  /**
   * 이상 징after 심각도 계산
   * 
   * value이 임계value을 초과하는 정도에 따라 심각도를 결정does:
   * - LOW: 초과 정도 < 20%
   * - MEDIUM: 초과 정도 20-50%
   * - HIGH: 초과 정도 > 50%
   * 
   * @param value 실제 value
   * @param threshold 임계value
   * @param direction 'higher' (value이 높을수록 나쁨) 또는 'lower' (value이 낮을수록 나쁨)
   * @returns 심각도
   * 
   * Validates: Property 23 - 이상 징after 경고 임계value
   */
  private calculateSeverity(
    value: number,
    threshold: number,
    direction: 'higher' | 'lower',
  ): AnomalySeverity {
    let exceedanceRatio: number;

    if (direction === 'higher') {
      // value이 높을수록 나쁨 (예: Latency)
      // 초과 rate = (value - threshold) / threshold
      exceedanceRatio = (value - threshold) / threshold;
    } else {
      // value이 낮을수록 나쁨 (예: 성공률, 만족도)
      // 초과 rate = (threshold - value) / threshold
      exceedanceRatio = (threshold - value) / threshold;
    }

    // 심각도 결정
    if (exceedanceRatio > 0.5) {
      return 'HIGH';
    } else if (exceedanceRatio >= 0.2) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }
}
