import { Injectable, Logger } from '@nestjs/common';
import { SpanService } from './span.service';
import { RedisService } from '../memory/redis.service';
import {
  Span,
  SpanType,
  SpanStatus,
  LearningRecord,
  QueryFeatures,
  QueryType,
} from './dto/span.dto';
import {
  TimeWindow,
  AggregateFilter,
  AggregatedMetrics,
  ModelMetrics,
  UserPatterns,
  UserMetrics,
  GlobalMetrics,
  AggregationSaveResult,
} from './dto/analytics.dto';

/**
 * Adapter Service
 * 
 * 원시 Span data를 learnable format(LearningRecord)으로 converts.
 * time 윈도우별 집계 및 Redis 저장을 담당does.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 8.3
 */
@Injectable()
export class AdapterService {
  private readonly logger = new Logger(AdapterService.name);

  // TTL 상수 (초 단above)
  static readonly AGGREGATION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30일 = 2592000초

  // Redis key 프리픽스
  private readonly METRICS_MODEL_PREFIX = 'metrics:model:';
  private readonly METRICS_USER_PREFIX = 'metrics:user:';
  private readonly METRICS_GLOBAL_PREFIX = 'metrics:global:';

  // 코드 관련 keyword
  private readonly CODE_KEYWORDS = [
    'function', 'class', 'const', 'let', 'var', 'import', 'export',
    'async', 'await', 'return', 'if', 'else', 'for', 'while',
    'try', 'catch', 'throw', 'new', 'this', 'interface', 'type',
    '코드', '함수', '클래스', '변수', '에러', '버그', 'debug',
    'コード', '関数', 'クラス', '変数', 'エラー', 'バグ',
  ];

  // 질문 pattern
  private readonly QUESTION_PATTERNS = [
    /\?$/,                    // 물음표로 끝남
    /^(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did)/i,
    /^(뭐|무엇|어떻게|왜|언제|어디|누가|어느|할 수|가능|인가|인지)/,
    /^(何|どう|なぜ|いつ|どこ|誰|どの|できる|可能)/,
    /(알려|설명|가르쳐|도와)/,
    /(教えて|説明して|助けて)/,
  ];

  // Language detection pattern
  private readonly LANGUAGE_PATTERNS: { pattern: RegExp; language: string }[] = [
    { pattern: /[\uAC00-\uD7AF]/, language: 'ko' },  // 한글
    { pattern: /[\u3040-\u309F\u30A0-\u30FF]/, language: 'ja' },  // Japanese
    { pattern: /[\u4E00-\u9FFF]/, language: 'zh' },  // during국어
    { pattern: /[a-zA-Z]/, language: 'en' },  // English (default)
  ];

  constructor(
    private readonly spanService: SpanService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Span LearningRecord로 변환
   * 
   * @param span 원시 Span data
   * @returns learnable format의 LearningRecord
   * 
   * Requirements: 3.1
   * Validates: Property 10 - LearningRecord 변환 완before성
   */
  transformToLearningRecord(span: Span): LearningRecord {
    // 쿼리 Extract text (metadata에서)
    const queryText = this.extractQueryText(span);
    
    // Extract query features
    const features = this.extractQueryFeatures(queryText);
    
    // Query type classification
    const queryType = this.classifyQueryType(span, features);
    
    // LearningRecord 생성
    const learningRecord: LearningRecord = {
      queryType,
      modelUsed: span.modelUsed || 'unknown',
      latencyMs: span.latencyMs || 0,
      tokensUsed: span.tokensUsed || 0,
      success: span.success ?? false,
      features,
    };

    // Feedback score 추가 (있는 case)
    if (span.feedbackId && span.metadata?.feedbackScore !== undefined) {
      learningRecord.feedbackScore = span.metadata.feedbackScore;
    }

    this.logger.debug(
      `Transformed Span ${span.id} to LearningRecord: type=${queryType}, model=${learningRecord.modelUsed}`,
    );

    return learningRecord;
  }

  /**
   * from Span 쿼리 Extract text
   */
  private extractQueryText(span: Span): string {
    // metadata에서 쿼리 Extract text 시도
    const metadata = span.metadata || {};
    
    // 다양한 필드명 시도
    const queryText = 
      metadata.query ||
      metadata.prompt ||
      metadata.message ||
      metadata.input ||
      metadata.text ||
      '';

    return String(queryText);
  }

  /**
   * Extract query features
   * 
   * @param queryText 쿼리 텍스트
   * @returns QueryFeatures
   */
  extractQueryFeatures(queryText: string): QueryFeatures {
    const text = queryText || '';
    
    return {
      hasCode: this.detectCode(text),
      hasQuestion: this.detectQuestion(text),
      language: this.detectLanguage(text),
      length: text.length,
      keywords: this.extractKeywords(text),
    };
  }

  /**
   * Whether code is included 감지
   */
  private detectCode(text: string): boolean {
    // 코드 블록 pattern 확인
    if (/```[\s\S]*```/.test(text)) {
      return true;
    }

    // 인라인 코드 pattern 확인
    if (/`[^`]+`/.test(text)) {
      return true;
    }

    // 코드 관련 keyword 확인
    const lowerText = text.toLowerCase();
    const codeKeywordCount = this.CODE_KEYWORDS.filter(
      keyword => lowerText.includes(keyword.toLowerCase())
    ).length;

    // 2개 이상의 코드 keywordif present 코드로 판단
    return codeKeywordCount >= 2;
  }

  /**
   * 질문 whether 감지
   */
  private detectQuestion(text: string): boolean {
    return this.QUESTION_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * Language detection
   */
  private detectLanguage(text: string): string {
    for (const { pattern, language } of this.LANGUAGE_PATTERNS) {
      if (pattern.test(text)) {
        return language;
      }
    }
    return 'unknown';
  }

  /**
   * Keyword extraction
   */
  private extractKeywords(text: string): string[] {
    if (!text) return [];

    // 단어 분리 (공백, 구두점 기준)
    const words = text
      .toLowerCase()
      .split(/[\s,.!?;:'"()\[\]{}]+/)
      .filter(word => word.length >= 2 && word.length <= 30);

    // 불용어 제거
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'shall',
      'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
      'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below',
      'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either',
      'neither', 'not', 'only', 'own', 'same', 'than', 'too',
      'very', 'just', 'also', 'now', 'here', 'there', 'when',
      'where', 'why', 'how', 'all', 'each', 'every', 'both',
      'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'this', 'that', 'these', 'those', 'it', 'its',
      // Korean 불용어
      '이', '그', '저', '것', '수', '등', '및', '또는', '그리고',
      '하다', '되다', '있다', '없다', '같다', '보다', 'above해',
      // Japanese 불용어
      'の', 'に', 'は', 'を', 'た', 'が', 'で', 'て', 'と', 'し',
      'れ', 'さ', 'ある', 'いる', 'も', 'する', 'から', 'な', 'こと',
    ]);

    const filteredWords = words.filter(word => !stopWords.has(word));

    // 빈도수 계산
    const wordFreq = new Map<string, number>();
    for (const word of filteredWords) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    // 빈도순 정렬 after 상above 10개 반환
    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Query type classification
   */
  private classifyQueryType(span: Span, features: QueryFeatures): string {
    // Span type에 따른 default 분류
    switch (span.type) {
      case SpanType.SEARCH:
        return QueryType.SEARCH;
      case SpanType.OCR:
        return QueryType.ANALYSIS;
      case SpanType.FEEDBACK:
        return QueryType.GENERAL;
    }

    // Code-related query
    if (features.hasCode) {
      return QueryType.CODE;
    }

    // Translation request 감지
    const queryText = this.extractQueryText(span).toLowerCase();
    if (
      queryText.includes('번역') ||
      queryText.includes('translate') ||
      queryText.includes('翻訳')
    ) {
      return QueryType.TRANSLATION;
    }

    // Analysis request 감지
    if (
      queryText.includes('분석') ||
      queryText.includes('analyze') ||
      queryText.includes('analysis') ||
      queryText.includes('分析')
    ) {
      return QueryType.ANALYSIS;
    }

    // 검색 요청 감지
    if (
      queryText.includes('검색') ||
      queryText.includes('search') ||
      queryText.includes('찾아') ||
      queryText.includes('検索')
    ) {
      return QueryType.SEARCH;
    }

    // default
    return features.hasQuestion ? QueryType.GENERAL : QueryType.UNKNOWN;
  }

  // ==================== 집계 기능 (Requirements: 3.2, 3.3, 3.4, 3.5, 8.3) ====================

  /**
   * time 윈도우별 집계
   * 
   * @param filter 집계 filter (timeWindow, userId, sessionId, model)
   * @returns 집계된 메트릭
   * 
   * Requirements: 3.2, 3.3, 3.4
   * Validates: Property 11 - aggregated metrics 계산 정확성
   */
  async aggregate(filter: AggregateFilter): Promise<AggregatedMetrics> {
    const { timeWindow, userId, sessionId, model } = filter;
    const { startTime, endTime } = this.getTimeRange(timeWindow);

    // Get Span를 above한 filter 구성
    const spanFilter: any = {
      startTime: new Date(startTime),
      endTime: new Date(endTime),
    };

    // userId 또는 sessionId가 있어야 조회 가능
    if (userId) {
      spanFilter.userId = userId;
    } else if (sessionId) {
      spanFilter.sessionId = sessionId;
    } else {
      // filter 없으면 빈 Result 반환
      this.logger.warn('aggregate called without userId or sessionId');
      return this.createEmptyAggregatedMetrics(timeWindow, startTime, endTime);
    }

    // Get Span
    let spans = await this.spanService.findMany(spanFilter);

    // 모델 filter 적용
    if (model) {
      spans = spans.filter(span => span.modelUsed === model);
    }

    // 완료된 Span만 집계
    spans = spans.filter(span => span.status === SpanStatus.COMPLETED);

    // 메트릭 계산
    const metrics = this.calculateAggregatedMetrics(spans, timeWindow, startTime, endTime);

    // Redis에 저장
    await this.saveAggregatedMetrics(metrics, filter);

    return metrics;
  }

  /**
   * 모델별 성능 집계
   * 
   * @param timeWindow time 윈도우
   * @param userId optional적 사용자 ID (없으면 cache된 data 사용)
   * @returns metrics by model array
   * 
   * Requirements: 3.2, 3.3, 3.4
   */
  async aggregateByModel(timeWindow: TimeWindow, userId?: string): Promise<ModelMetrics[]> {
    const { startTime, endTime } = this.getTimeRange(timeWindow);

    // userIdif not present cache된 글로벌 data에서 조회 시도
    if (!userId) {
      const cachedGlobal = await this.getGlobalMetrics(timeWindow);
      if (cachedGlobal && cachedGlobal.modelDistribution.length > 0) {
        // cache된 모델 분포에서 ModelMetrics 생성
        return cachedGlobal.modelDistribution.map(dist => ({
          model: dist.model,
          requestCount: dist.count,
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          successRate: 0,
          totalTokens: 0,
          avgFeedbackScore: 0,
          fallbackCount: 0,
        }));
      }
      return [];
    }

    // Get Span
    const spans = await this.spanService.findMany({
      userId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
    });

    // 완료된 Span만 filter링
    const completedSpans = spans.filter(span => span.status === SpanStatus.COMPLETED);

    // 모델별 group화
    const modelGroups = this.groupByModel(completedSpans);

    // 각 metrics by model 계산
    const modelMetrics: ModelMetrics[] = [];
    for (const [model, modelSpans] of modelGroups.entries()) {
      const metrics = this.calculateModelMetrics(model, modelSpans);
      modelMetrics.push(metrics);

      // Redis에 저장
      await this.saveModelMetrics(model, timeWindow, metrics);
    }

    // 요청 수 기준 내림차순 정렬
    modelMetrics.sort((a, b) => b.requestCount - a.requestCount);

    return modelMetrics;
  }

  /**
   * per user pattern 집계
   * 
   * @param userId 사용자 ID
   * @param timeWindow time 윈도우
   * @returns 사용자 pattern
   * 
   * Requirements: 3.2, 3.3, 3.4
   */
  async aggregateByUser(userId: string, timeWindow: TimeWindow): Promise<UserPatterns> {
    const { startTime, endTime } = this.getTimeRange(timeWindow);

    // Get Span
    const spans = await this.spanService.findMany({
      userId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
    });

    // 완료된 Span만 filter링
    const completedSpans = spans.filter(span => span.status === SpanStatus.COMPLETED);

    // 사용자 pattern 계산
    const patterns = this.calculateUserPatterns(userId, timeWindow, completedSpans);

    // Redis에 저장
    await this.saveUserPatterns(userId, timeWindow, patterns);

    return patterns;
  }

  /**
   * Get global metrics (cache)
   * 
   * @param timeWindow time 윈도우
   * @returns 글로벌 메트릭 또는 null
   */
  async getGlobalMetrics(timeWindow: TimeWindow): Promise<GlobalMetrics | null> {
    if (!this.redis.isReady()) {
      return null;
    }

    const key = this.getGlobalMetricsKey(timeWindow);
    return this.redis.getJson<GlobalMetrics>(key);
  }

  /**
   * model metrics 조회 (cache)
   * 
   * @param model 모델명
   * @param timeWindow time 윈도우
   * @returns model metrics 또는 null
   */
  async getModelMetrics(model: string, timeWindow: TimeWindow): Promise<ModelMetrics | null> {
    if (!this.redis.isReady()) {
      return null;
    }

    const key = this.getModelMetricsKey(model, timeWindow);
    return this.redis.getJson<ModelMetrics>(key);
  }

  /**
   * Get user metrics (cache)
   * 
   * @param userId 사용자 ID
   * @param timeWindow time 윈도우
   * @returns 사용자 메트릭 또는 null
   */
  async getUserMetrics(userId: string, timeWindow: TimeWindow): Promise<UserMetrics | null> {
    if (!this.redis.isReady()) {
      return null;
    }

    const key = this.getUserMetricsKey(userId, timeWindow);
    return this.redis.getJson<UserMetrics>(key);
  }

  // ==================== Private Helper Methods ====================

  /**
   * time 윈도우에 따른 time 범above 계산
   */
  private getTimeRange(timeWindow: TimeWindow): { startTime: string; endTime: string } {
    const now = new Date();
    const endTime = now.toISOString();
    
    let startDate: Date;
    switch (timeWindow) {
      case '1h':
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    return {
      startTime: startDate.toISOString(),
      endTime,
    };
  }

  /**
   * 빈 aggregated metrics 생성
   */
  private createEmptyAggregatedMetrics(
    timeWindow: TimeWindow,
    startTime: string,
    endTime: string,
  ): AggregatedMetrics {
    return {
      timeWindow,
      startTime,
      endTime,
      totalRequests: 0,
      avgLatencyMs: 0,
      successRate: 0,
      totalTokens: 0,
      tokenEfficiency: 0,
    };
  }

  /**
   * Span list에서 aggregated metrics 계산
   * 
   * Requirements: 3.3
   * - average Latency 계산
   * - 성공률 계산
   * - Calculate token efficiency
   */
  private calculateAggregatedMetrics(
    spans: Span[],
    timeWindow: TimeWindow,
    startTime: string,
    endTime: string,
  ): AggregatedMetrics {
    if (spans.length === 0) {
      return this.createEmptyAggregatedMetrics(timeWindow, startTime, endTime);
    }

    // 총 요청 수
    const totalRequests = spans.length;

    // average Latency 계산
    const latencies = spans
      .filter(span => span.latencyMs !== undefined && span.latencyMs !== null)
      .map(span => span.latencyMs!);
    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length
      : 0;

    // 성공률 계산
    const successCount = spans.filter(span => span.success === true).length;
    const successRate = totalRequests > 0 ? successCount / totalRequests : 0;

    // 총 token count
    const totalTokens = spans
      .filter(span => span.tokensUsed !== undefined && span.tokensUsed !== null)
      .reduce((sum, span) => sum + span.tokensUsed!, 0);

    // token efficiency (토large당 response length)
    const totalResponseLength = spans
      .filter(span => span.responseLength !== undefined && span.responseLength !== null)
      .reduce((sum, span) => sum + span.responseLength!, 0);
    const tokenEfficiency = totalTokens > 0 ? totalResponseLength / totalTokens : 0;

    return {
      timeWindow,
      startTime,
      endTime,
      totalRequests,
      avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
      successRate: Math.round(successRate * 10000) / 10000, // 소수점 4자리
      totalTokens,
      tokenEfficiency: Math.round(tokenEfficiency * 100) / 100,
    };
  }

  /**
   * Span 모델별로 group화
   */
  private groupByModel(spans: Span[]): Map<string, Span[]> {
    const groups = new Map<string, Span[]>();
    
    for (const span of spans) {
      const model = span.modelUsed || 'unknown';
      if (!groups.has(model)) {
        groups.set(model, []);
      }
      groups.get(model)!.push(span);
    }

    return groups;
  }

  /**
   * metrics by model 계산
   */
  private calculateModelMetrics(model: string, spans: Span[]): ModelMetrics {
    const requestCount = spans.length;

    // Latency 계산
    const latencies = spans
      .filter(span => span.latencyMs !== undefined && span.latencyMs !== null)
      .map(span => span.latencyMs!)
      .sort((a, b) => a - b);

    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length
      : 0;

    // P95 Latency
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95LatencyMs = latencies.length > 0 ? latencies[p95Index] || latencies[latencies.length - 1] : 0;

    // 성공률
    const successCount = spans.filter(span => span.success === true).length;
    const successRate = requestCount > 0 ? successCount / requestCount : 0;

    // 총 토large
    const totalTokens = spans
      .filter(span => span.tokensUsed !== undefined && span.tokensUsed !== null)
      .reduce((sum, span) => sum + span.tokensUsed!, 0);

    // fallback 횟수
    const fallbackCount = spans.filter(span => span.fallbackUsed === true).length;

    // Feedback score (있는 case)
    const feedbackScores = spans
      .filter(span => span.metadata?.feedbackScore !== undefined)
      .map(span => span.metadata.feedbackScore as number);
    const avgFeedbackScore = feedbackScores.length > 0
      ? feedbackScores.reduce((sum, score) => sum + score, 0) / feedbackScores.length
      : 0;

    return {
      model,
      requestCount,
      avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
      p95LatencyMs: Math.round(p95LatencyMs * 100) / 100,
      successRate: Math.round(successRate * 10000) / 10000,
      totalTokens,
      avgFeedbackScore: Math.round(avgFeedbackScore * 100) / 100,
      fallbackCount,
    };
  }

  /**
   * 사용자 pattern 계산
   */
  private calculateUserPatterns(
    userId: string,
    timeWindow: TimeWindow,
    spans: Span[],
  ): UserPatterns {
    // preference 모델 (가장 많이 사용한 모델)
    const modelCounts = new Map<string, number>();
    for (const span of spans) {
      const model = span.modelUsed || 'unknown';
      modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    }
    const preferredModel = modelCounts.size > 0
      ? Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
      : undefined;

    // average Query length
    const queryLengths = spans
      .filter(span => span.metadata?.query)
      .map(span => String(span.metadata.query).length);
    const avgQueryLength = queryLengths.length > 0
      ? queryLengths.reduce((sum, len) => sum + len, 0) / queryLengths.length
      : 0;

    // 상above query type
    const queryTypeCounts = new Map<string, number>();
    for (const span of spans) {
      const learningRecord = this.transformToLearningRecord(span);
      queryTypeCounts.set(
        learningRecord.queryType,
        (queryTypeCounts.get(learningRecord.queryType) || 0) + 1,
      );
    }
    const topQueryTypes = Array.from(queryTypeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type]) => type);

    // peak usage hours대
    const hourCounts = new Map<number, number>();
    for (const span of spans) {
      const hour = new Date(span.startTime).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }
    const peakUsageHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => hour);

    return {
      userId,
      timeWindow,
      preferredModel,
      avgQueryLength: Math.round(avgQueryLength),
      topQueryTypes,
      peakUsageHours,
    };
  }

  // ==================== Redis 저장 메서드 (Requirements: 3.5, 8.3) ====================

  /**
   * aggregated metrics Redis 저장
   * 
   * Requirements: 3.5, 8.3
   * Validates: Property 12 - 집계 data 저장 key format
   * Validates: Property 26 - 집계 data TTL 설정 (30일)
   */
  private async saveAggregatedMetrics(
    metrics: AggregatedMetrics,
    filter: AggregateFilter,
  ): Promise<AggregationSaveResult> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available, skipping aggregated metrics save');
      return { key: '', ttlSeconds: 0, success: false };
    }

    // key 생성: metrics:{dimension}:{value}:{timeWindow}
    let key: string;
    if (filter.userId) {
      key = `${this.METRICS_USER_PREFIX}${filter.userId}:${filter.timeWindow}`;
    } else if (filter.sessionId) {
      key = `metrics:session:${filter.sessionId}:${filter.timeWindow}`;
    } else if (filter.model) {
      key = `${this.METRICS_MODEL_PREFIX}${filter.model}:${filter.timeWindow}`;
    } else {
      key = `${this.METRICS_GLOBAL_PREFIX}${filter.timeWindow}`;
    }

    await this.redis.setJson(key, metrics, AdapterService.AGGREGATION_TTL_SECONDS);
    
    this.logger.debug(`Saved aggregated metrics to ${key} with TTL ${AdapterService.AGGREGATION_TTL_SECONDS}s`);
    
    return {
      key,
      ttlSeconds: AdapterService.AGGREGATION_TTL_SECONDS,
      success: true,
    };
  }

  /**
   * model metrics Redis 저장
   * 
   * Requirements: 3.5, 8.3
   */
  private async saveModelMetrics(
    model: string,
    timeWindow: TimeWindow,
    metrics: ModelMetrics,
  ): Promise<AggregationSaveResult> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available, skipping model metrics save');
      return { key: '', ttlSeconds: 0, success: false };
    }

    const key = this.getModelMetricsKey(model, timeWindow);
    await this.redis.setJson(key, metrics, AdapterService.AGGREGATION_TTL_SECONDS);
    
    this.logger.debug(`Saved model metrics for ${model} to ${key}`);
    
    return {
      key,
      ttlSeconds: AdapterService.AGGREGATION_TTL_SECONDS,
      success: true,
    };
  }

  /**
   * 사용자 pattern Redis 저장
   * 
   * Requirements: 3.5, 8.3
   */
  private async saveUserPatterns(
    userId: string,
    timeWindow: TimeWindow,
    patterns: UserPatterns,
  ): Promise<AggregationSaveResult> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available, skipping user patterns save');
      return { key: '', ttlSeconds: 0, success: false };
    }

    const key = this.getUserMetricsKey(userId, timeWindow);
    await this.redis.setJson(key, patterns, AdapterService.AGGREGATION_TTL_SECONDS);
    
    this.logger.debug(`Saved user patterns for ${userId} to ${key}`);
    
    return {
      key,
      ttlSeconds: AdapterService.AGGREGATION_TTL_SECONDS,
      success: true,
    };
  }

  // ==================== Redis key 생성 헬퍼 ====================

  /**
   * model metrics key 생성
   * format: metrics:model:{model}:{timeWindow}
   */
  private getModelMetricsKey(model: string, timeWindow: TimeWindow): string {
    return `${this.METRICS_MODEL_PREFIX}${model}:${timeWindow}`;
  }

  /**
   * 사용자 메트릭 key 생성
   * format: metrics:user:{userId}:{timeWindow}
   */
  private getUserMetricsKey(userId: string, timeWindow: TimeWindow): string {
    return `${this.METRICS_USER_PREFIX}${userId}:${timeWindow}`;
  }

  /**
   * 글로벌 메트릭 key 생성
   * format: metrics:global:{timeWindow}
   */
  private getGlobalMetricsKey(timeWindow: TimeWindow): string {
    return `${this.METRICS_GLOBAL_PREFIX}${timeWindow}`;
  }

  // ==================== GDPR 삭제 기능 (Requirements: 8.4) ====================

  /**
   * user's 모든 집계 data 삭제 (GDPR)
   * 
   * 삭제 대상:
   * - metrics:user:{userId}:* (모든 time 윈도우)
   * 
   * @param userId 사용자 ID
   * @returns 삭제된 key 수
   * 
   * Requirements: 8.4
   * Validates: Property 27 - GDPR 삭제 완before성
   */
  async deleteUserAggregations(userId: string): Promise<number> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available for deleteUserAggregations');
      return 0;
    }

    // 모든 time 윈도우에 대한 사용자 메트릭 key pattern
    const pattern = `${this.METRICS_USER_PREFIX}${userId}:*`;
    
    // pattern에 매칭되는 모든 key 조회
    const keys = await this.redis.scanKeys(pattern);
    
    if (keys.length === 0) {
      this.logger.debug(`No aggregation data found for user: ${userId}`);
      return 0;
    }

    // 모든 key 삭제
    await this.redis.delMultiple(keys);
    
    this.logger.log(`Deleted ${keys.length} aggregation keys for user: ${userId}`);
    return keys.length;
  }
}
