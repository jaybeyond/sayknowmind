import { Injectable, Logger } from '@nestjs/common';
import { AdapterService } from './adapter.service';
import { GlobalLearningService } from '../memory/global-learning.service';
import { RedisService } from '../memory/redis.service';
import { QueryPattern } from '../memory/dto/memory.dto';
import {
  QueryContext,
  ModelRecommendation,
  FeatureRecommendation,
  LearnedPattern,
  LearnResult,
  FeedbackWithSpan,
} from './dto/algorithm.dto';

/**
 * Algorithm Service
 * 
 * AI Model recommendation 및 기능 자동 enabled를 담당하는 serviceis.
 * 쿼리 분석을 통해 최적의 모델을 추천하고, 검색/사고 모드 enabled whether를 결정does.
 * Pattern learning 및 Feedback-based learning 기능을 provides.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
@Injectable()
export class AlgorithmService {
  private readonly logger = new Logger(AlgorithmService.name);

  // 학습 관련 상수
  static readonly CONFIDENCE_THRESHOLD = 0.7;
  static readonly MIN_SAMPLE_COUNT = 10;
  static readonly PATTERN_KEY_PREFIX = 'learning:pattern:';

  // 모델 설정 (서버 구성 기반)
  private readonly MODELS = {
    // Pro 모델 (품질 우선)
    PRO_KOREAN: 'upstage/solar-pro-3',
    PRO_JAPANESE: 'upstage/solar-pro-3',
    PRO_DEFAULT: 'stepfun/step-3.5-flash',
    PRO_FALLBACK_1: 'qwen/qwen3-next-80b',
    PRO_FALLBACK_2: 'zhipu-ai/glm-4.7',
    
    // Flash 모델 (속도 우선)
    FLASH_DEFAULT: 'stepfun/step-3.5-flash',
    FLASH_FALLBACK_1: 'cloudflare/llama-3.1-70b',
    FLASH_FALLBACK_2: 'qwen/qwen3-next-80b',
    
    // 코드 특화 모델
    CODE_MODEL: 'qwen/qwen3-next-80b',
    
    // 최종 fallback
    FINAL_FALLBACK: 'google/gemini-2.5-flash',
  };

  // search needed keyword pattern
  private readonly SEARCH_PATTERNS = [
    // time 관련
    /오늘|내일|어제|current|지금|최근|요즘|today|tomorrow|yesterday|current|now|recent|lately/i,
    // 날씨
    /날씨|기온|비|눈|맑|흐림|weather|forecast|temperature/i,
    // 뉴스/info
    /뉴스|소식|news|latest|속보|breaking/i,
    // 가격/시세
    /주가|주식|stock|price|시세|환율|가격|얼마/i,
    // 검색 요청
    /검색해|찾아봐|search|look up|알아봐|찾아줘/i,
    // location/장소
    /어디서|어디에|where|location|장소|맛집|추천/i,
    // 사실 확인
    /사실인가|진짜|정말|is it true|really|actually/i,
    // event/일정
    /언제|when|일정|schedule|event|행사/i,
  ];

  // 사고 모드 필요 keyword pattern
  private readonly THINKING_PATTERNS = [
    // 코드 관련
    /코드|함수|클래스|버그|에러|code|function|class|bug|error|debug|```/i,
    // 분석/설명
    /분석|analyze|analysis|설명해|explain|왜|why|이유/i,
    // 비교
    /비교|compare|차이|difference|장단점|pros|cons|vs/i,
    // 설계/아key텍처
    /설계|design|아key텍처|architecture|structure|structure/i,
    // 최적화
    /최적화|optimize|성능|performance|개선|improve/i,
    // 알고리즘/로직
    /알고리즘|algorithm|로직|logic|구현|implement/i,
    // 문제 해결
    /문제|problem|해결|solve|solution|풀어/i,
    // 수학/계산
    /계산|calculate|수학|math|공식|formula/i,
    // complex 추론
    /단계별|step by step|차근차근|하나씩/i,
  ];

  // Language detection pattern
  private readonly LANGUAGE_PATTERNS: { pattern: RegExp; language: string }[] = [
    { pattern: /[\uAC00-\uD7AF]/, language: 'ko' },  // 한글
    { pattern: /[\u3040-\u309F\u30A0-\u30FF]/, language: 'ja' },  // Japanese
    { pattern: /[\u4E00-\u9FFF]/, language: 'zh' },  // during국어
    { pattern: /[a-zA-Z]/, language: 'en' },  // English (default)
  ];

  constructor(
    private readonly adapterService: AdapterService,
    private readonly globalLearning: GlobalLearningService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 쿼리에 대한 최적 Model recommendation
   * 
   * 언어, query type, Context를 분석하여 최적의 AI 모델을 추천does.
   * 
   * @param query 사용자 쿼리
   * @param context 쿼리 Context (userId, sessionId, language 등)
   * @returns ModelRecommendation Model recommendation Result
   * 
   * Requirements: 4.1
   */
  recommendModel(query: string, context: QueryContext = {}): ModelRecommendation {
    // 1. Language detection
    const detectedLanguage = context.language || this.detectLanguage(query);
    
    // 2. query type 분석
    const queryType = context.queryType || this.analyzeQueryType(query);
    
    // 3. model selection 로직
    let model: string;
    let confidence: number;
    let reason: string;
    let alternatives: string[];

    // Code-related query는 대형 모델 사용
    if (queryType === 'code') {
      model = this.MODELS.CODE_MODEL;
      confidence = 0.85;
      reason = 'Code-related query detected, using larger model for better code understanding';
      alternatives = [this.MODELS.PRO_DEFAULT, this.MODELS.PRO_FALLBACK_1];
    }
    // Korean/Japanese 사용자는 Solar Pro 우선
    else if (detectedLanguage === 'ko' || detectedLanguage === 'ja') {
      model = this.MODELS.PRO_KOREAN;
      confidence = 0.9;
      reason = `${detectedLanguage === 'ko' ? 'Korean' : 'Japanese'} language detected, using Solar Pro for better language support`;
      alternatives = [this.MODELS.PRO_DEFAULT, this.MODELS.PRO_FALLBACK_1, this.MODELS.PRO_FALLBACK_2];
    }
    // simple 쿼리는 Flash 모델 사용
    else if (this.isSimpleQuery(query)) {
      model = this.MODELS.FLASH_DEFAULT;
      confidence = 0.8;
      reason = 'Simple query detected, using faster Flash model';
      alternatives = [this.MODELS.FLASH_FALLBACK_1, this.MODELS.FLASH_FALLBACK_2];
    }
    // default: Pro 모델
    else {
      model = this.MODELS.PRO_DEFAULT;
      confidence = 0.75;
      reason = 'Default model selection for general queries';
      alternatives = [this.MODELS.PRO_FALLBACK_1, this.MODELS.PRO_FALLBACK_2, this.MODELS.FINAL_FALLBACK];
    }

    // previous 모델 사용 고려 (세션 일관성)
    if (context.previousModel && confidence < 0.85) {
      // previous 모델이 있고 current 추천 신뢰도가 낮으면 previous 모델 유지 고려
      const previousModelInAlternatives = alternatives.includes(context.previousModel);
      if (previousModelInAlternatives) {
        this.logger.debug(`Considering previous model ${context.previousModel} for session consistency`);
      }
    }

    const recommendation: ModelRecommendation = {
      model,
      confidence,
      reason,
      alternatives,
    };

    this.logger.debug(
      `Model recommendation for query: ${query.substring(0, 50)}... -> ${model} (confidence: ${confidence})`,
    );

    return recommendation;
  }

  /**
   * 검색/사고 모드 자동 enabled 판단
   * 
   * 쿼리를 분석하여 Web search이나 사고 모드가 필요한지 판단does.
   * 
   * @param query 사용자 쿼리
   * @returns FeatureRecommendation Feature recommendation Result
   * 
   * Requirements: 4.3
   */
  shouldEnableFeatures(query: string): FeatureRecommendation {
    let enableSearch = false;
    let enableThinking = false;
    let searchConfidence = 0;
    let thinkingConfidence = 0;

    // 검색 Pattern matching
    for (const pattern of this.SEARCH_PATTERNS) {
      if (pattern.test(query)) {
        enableSearch = true;
        searchConfidence = Math.max(searchConfidence, 0.8);
      }
    }

    // 사고 모드 Pattern matching
    for (const pattern of this.THINKING_PATTERNS) {
      if (pattern.test(query)) {
        enableThinking = true;
        thinkingConfidence = Math.max(thinkingConfidence, 0.8);
      }
    }

    // 코드 블록if present 사고 모드 강력 추천
    if (query.includes('```')) {
      enableThinking = true;
      thinkingConfidence = Math.max(thinkingConfidence, 0.95);
    }

    // 긴 쿼리는 사고 모드 가during치 증가
    if (query.length > 200) {
      thinkingConfidence = Math.min(thinkingConfidence + 0.1, 0.95);
    }

    // GlobalLearning에서 추가 pattern 확인
    this.checkGlobalLearningPatterns(query).then(result => {
      if (result.action === 'enableSearch' && result.confidence > searchConfidence) {
        enableSearch = true;
        searchConfidence = result.confidence;
      }
      if (result.action === 'enableThinking' && result.confidence > thinkingConfidence) {
        enableThinking = true;
        thinkingConfidence = result.confidence;
      }
    }).catch(() => {
      // GlobalLearning on failure 무시
    });

    // 최종 신뢰도 계산 (검색과 사고 모드 during high 것)
    const confidence = Math.max(
      enableSearch ? searchConfidence : 0,
      enableThinking ? thinkingConfidence : 0,
    );

    const recommendation: FeatureRecommendation = {
      enableSearch,
      enableThinking,
      confidence: confidence || 0.5, // default 신뢰도
    };

    this.logger.debug(
      `Feature recommendation for query: ${query.substring(0, 50)}... -> search=${enableSearch}, thinking=${enableThinking}`,
    );

    return recommendation;
  }

  // ==================== Learning Methods (Requirements: 4.2, 4.4) ====================

  /**
   * Pattern learning (배치)
   * 
   * 수집된 Span data를 분석하여 pattern을 학습does.
   * 신뢰도 0.7 이상인 pattern만 saves.
   * 
   * @returns LearnResult Learning result
   * 
   * Requirements: 4.2, 4.4
   */
  async learnPatterns(): Promise<LearnResult> {
    const timestamp = new Date().toISOString();
    let patternsLearned = 0;
    let patternsApplied = 0;

    try {
      // 1. 최근 Span data 조회 (AdapterService를 통해)
      // time 윈도우: 최근 24time
      const recentSpans = await this.getRecentSpansForLearning();

      if (recentSpans.length < AlgorithmService.MIN_SAMPLE_COUNT) {
        this.logger.debug(
          `Not enough samples for learning: ${recentSpans.length} < ${AlgorithmService.MIN_SAMPLE_COUNT}`,
        );
        return { patternsLearned: 0, patternsApplied: 0, timestamp };
      }

      // 2. query type별 모델 pattern 분석
      const queryTypeModelPatterns = this.analyzeQueryTypeModelPatterns(recentSpans);

      // 3. Query features별 기능 pattern 분석
      const featurePatterns = this.analyzeFeaturePatterns(recentSpans);

      // 4. 신뢰도 0.7 이상인 pattern만 저장
      for (const pattern of [...queryTypeModelPatterns, ...featurePatterns]) {
        patternsLearned++;
        
        if (pattern.confidence >= AlgorithmService.CONFIDENCE_THRESHOLD) {
          await this.savePattern(pattern);
          patternsApplied++;
          
          this.logger.debug(
            `Applied pattern: ${pattern.pattern} -> ${pattern.model} (confidence: ${pattern.confidence})`,
          );
        }
      }

      this.logger.log(
        `Learning completed: ${patternsLearned} patterns learned, ${patternsApplied} applied`,
      );
    } catch (error) {
      this.logger.error('Error during pattern learning:', error);
    }

    return { patternsLearned, patternsApplied, timestamp };
  }

  /**
   * Feedback-based learning
   * 
   * 사용자 feedback 분석하여 pattern을 학습does.
   * 긍정적 피드백은 해당 모델/기능 optional을 강화does.
   * 부정적 피드백은 대inside을 학습does.
   * 
   * @param feedbackWithSpan feedback and 연결된 Span info
   * 
   * Requirements: 4.2, 4.4
   */
  async learnFromFeedback(feedbackWithSpan: FeedbackWithSpan): Promise<void> {
    const { feedback, span } = feedbackWithSpan;

    try {
      // 1. from Span Extract query features
      const learningRecord = this.adapterService.transformToLearningRecord(span);
      const queryFeatures = learningRecord.features;

      // 2. current pattern 조회
      const patternKey = this.getPatternKeyForQuery(learningRecord.queryType, queryFeatures);
      const existingPattern = await this.getPattern(patternKey);

      // 3. in feedback 따른 pattern 업데이트
      if (feedback.isGood) {
        // 긍정적 피드백: current 모델/기능 optional 강화
        await this.reinforcePattern(
          patternKey,
          span.modelUsed || 'unknown',
          existingPattern,
        );
        
        // GlobalLearning에도 피드백 before달
        await this.globalLearning.learnFromFeedback(
          this.extractQueryFromSpan(span),
          this.determineActionFromSpan(span),
          true,
        );

        this.logger.debug(
          `Reinforced pattern for positive feedback: ${patternKey} -> ${span.modelUsed}`,
        );
      } else {
        // 부정적 피드백: 대inside 학습
        await this.learnAlternativePattern(
          patternKey,
          span.modelUsed || 'unknown',
          existingPattern,
          feedback.correctedText,
        );

        // GlobalLearning에도 피드백 before달
        await this.globalLearning.learnFromFeedback(
          this.extractQueryFromSpan(span),
          this.determineActionFromSpan(span),
          false,
        );

        this.logger.debug(
          `Learned alternative for negative feedback: ${patternKey}`,
        );
      }
    } catch (error) {
      this.logger.error('Error during feedback learning:', error);
    }
  }

  // ==================== Learning Helper Methods ====================

  /**
   * 학습을 above한 최근 Get Span
   */
  private async getRecentSpansForLearning(): Promise<any[]> {
    // AdapterService를 통해 최근 완료된 Get Span
    // 실제 구현에서는 SpanService를 직접 사용하거나 AdapterService에 메서드 추가 필요
    try {
      // cache된 글로벌 메트릭에서 모델 분포 확인
      const globalMetrics = await this.adapterService.getGlobalMetrics('24h');
      if (globalMetrics && globalMetrics.modelDistribution) {
        // 모델 분포 data를 기반으로 가상의 Span data 생성
        // 실제 구현에서는 SpanService.findMany를 사용
        return globalMetrics.modelDistribution.map(dist => ({
          modelUsed: dist.model,
          count: dist.count,
          success: true,
        }));
      }
    } catch (error) {
      this.logger.warn('Failed to get recent spans for learning:', error);
    }
    return [];
  }

  /**
   * query type별 모델 pattern 분석
   */
  private analyzeQueryTypeModelPatterns(spans: any[]): LearnedPattern[] {
    const patterns: LearnedPattern[] = [];
    const queryTypeModelCounts = new Map<string, Map<string, number>>();
    const queryTypeTotalCounts = new Map<string, number>();

    // query type별 모델 사용 횟수 집계
    for (const span of spans) {
      const queryType = span.queryType || 'general';
      const model = span.modelUsed || 'unknown';
      const count = span.count || 1;

      if (!queryTypeModelCounts.has(queryType)) {
        queryTypeModelCounts.set(queryType, new Map());
      }
      const modelCounts = queryTypeModelCounts.get(queryType)!;
      modelCounts.set(model, (modelCounts.get(model) || 0) + count);
      queryTypeTotalCounts.set(queryType, (queryTypeTotalCounts.get(queryType) || 0) + count);
    }

    // 각 query type별 최적 모델 pattern 생성
    for (const [queryType, modelCounts] of queryTypeModelCounts.entries()) {
      const totalCount = queryTypeTotalCounts.get(queryType) || 0;
      
      // 가장 많이 Model used 찾기
      let bestModel = 'unknown';
      let bestCount = 0;
      for (const [model, count] of modelCounts.entries()) {
        if (count > bestCount) {
          bestModel = model;
          bestCount = count;
        }
      }

      // 신뢰도 계산: (해당 모델 사용 횟수 / all 횟수) * (샘플 수 가during치)
      const usageRatio = totalCount > 0 ? bestCount / totalCount : 0;
      const sampleWeight = Math.min(1, totalCount / AlgorithmService.MIN_SAMPLE_COUNT);
      const confidence = usageRatio * sampleWeight;

      patterns.push({
        pattern: `queryType:${queryType}`,
        model: bestModel,
        confidence: Math.round(confidence * 100) / 100,
        sampleCount: totalCount,
        lastUpdated: new Date().toISOString(),
      });
    }

    return patterns;
  }

  /**
   * Query features별 기능 pattern 분석
   */
  private analyzeFeaturePatterns(spans: any[]): LearnedPattern[] {
    const patterns: LearnedPattern[] = [];
    
    // Code-related query pattern
    const codeSpans = spans.filter(s => s.hasCode || s.queryType === 'code');
    if (codeSpans.length >= AlgorithmService.MIN_SAMPLE_COUNT) {
      const successRate = codeSpans.filter(s => s.success).length / codeSpans.length;
      patterns.push({
        pattern: 'feature:hasCode',
        model: this.MODELS.CODE_MODEL,
        confidence: Math.round(successRate * 100) / 100,
        sampleCount: codeSpans.length,
        lastUpdated: new Date().toISOString(),
      });
    }

    return patterns;
  }

  /**
   * pattern 저장
   * Redis 장애 시에도 AI service는 정상 동작does. (Requirements 8.6)
   */
  private async savePattern(pattern: LearnedPattern): Promise<void> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available, skipping pattern save');
      return; // 에러 throw not done (Requirements 8.6)
    }

    try {
      const key = `${AlgorithmService.PATTERN_KEY_PREFIX}${pattern.pattern}`;
      await this.redis.setJson(key, pattern);
      
      this.logger.debug(`Saved pattern: ${key}`);
    } catch (error) {
      this.logger.warn('Failed to save pattern (Redis may be unavailable):', error);
      // error 발생해도 AI service에 영향 없음 (Requirements 8.6)
    }
  }

  /**
   * pattern 조회
   * Redis 장애 시 null을 returns. (Requirements 8.6)
   */
  private async getPattern(patternKey: string): Promise<LearnedPattern | null> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available, returning null for pattern');
      return null; // 에러 throw not done (Requirements 8.6)
    }

    try {
      const key = `${AlgorithmService.PATTERN_KEY_PREFIX}${patternKey}`;
      return this.redis.getJson<LearnedPattern>(key);
    } catch (error) {
      this.logger.warn('Failed to get pattern (Redis may be unavailable):', error);
      return null; // error 발생해도 AI service에 영향 없음 (Requirements 8.6)
    }
  }

  /**
   * 쿼리에 대한 pattern key 생성
   */
  private getPatternKeyForQuery(queryType: string, features: any): string {
    const parts = [`queryType:${queryType}`];
    
    if (features.hasCode) {
      parts.push('hasCode');
    }
    if (features.language && features.language !== 'unknown') {
      parts.push(`lang:${features.language}`);
    }

    return parts.join(':');
  }

  /**
   * pattern 강화 (긍정적 피드백)
   */
  private async reinforcePattern(
    patternKey: string,
    model: string,
    existingPattern: LearnedPattern | null,
  ): Promise<void> {
    const now = new Date().toISOString();

    if (existingPattern) {
      // existing pattern 강화: 신뢰도 증가 (max 0.99)
      const newConfidence = Math.min(0.99, existingPattern.confidence + 0.02);
      const updatedPattern: LearnedPattern = {
        ...existingPattern,
        confidence: Math.round(newConfidence * 100) / 100,
        sampleCount: existingPattern.sampleCount + 1,
        lastUpdated: now,
      };
      await this.savePattern(updatedPattern);
    } else {
      // new pattern 생성
      const newPattern: LearnedPattern = {
        pattern: patternKey,
        model,
        confidence: 0.7, // 초기 신뢰도
        sampleCount: 1,
        lastUpdated: now,
      };
      await this.savePattern(newPattern);
    }
  }

  /**
   * 대inside Pattern learning (부정적 피드백)
   */
  private async learnAlternativePattern(
    patternKey: string,
    currentModel: string,
    existingPattern: LearnedPattern | null,
    correctedText?: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    if (existingPattern) {
      // existing pattern 약화: 신뢰도 감소 (min 0.5)
      const newConfidence = Math.max(0.5, existingPattern.confidence - 0.05);
      const updatedPattern: LearnedPattern = {
        ...existingPattern,
        confidence: Math.round(newConfidence * 100) / 100,
        sampleCount: existingPattern.sampleCount + 1,
        lastUpdated: now,
      };
      await this.savePattern(updatedPattern);
    }

    // 대inside 모델 pattern 저장 (correctedTextif present 분석하여 대inside 모델 결정)
    if (correctedText) {
      const alternativeKey = `${patternKey}:alternative`;
      const alternativeModel = this.determineAlternativeModel(currentModel);
      
      const alternativePattern: LearnedPattern = {
        pattern: alternativeKey,
        model: alternativeModel,
        confidence: 0.6, // 대inside은 low 초기 신뢰도
        sampleCount: 1,
        lastUpdated: now,
      };
      await this.savePattern(alternativePattern);
    }
  }

  /**
   * 대inside 모델 결정
   */
  private determineAlternativeModel(currentModel: string): string {
    // current 모델의 대inside 반환
    const alternatives: Record<string, string> = {
      [this.MODELS.PRO_KOREAN]: this.MODELS.PRO_DEFAULT,
      [this.MODELS.PRO_DEFAULT]: this.MODELS.PRO_FALLBACK_1,
      [this.MODELS.FLASH_DEFAULT]: this.MODELS.FLASH_FALLBACK_1,
      [this.MODELS.CODE_MODEL]: this.MODELS.PRO_DEFAULT,
    };

    return alternatives[currentModel] || this.MODELS.FINAL_FALLBACK;
  }

  /**
   * from Span 쿼리 Extract text
   */
  private extractQueryFromSpan(span: any): string {
    const metadata = span.metadata || {};
    return metadata.query || metadata.prompt || metadata.message || '';
  }

  /**
   * from Span 액션 결정
   */
  private determineActionFromSpan(span: any): 'enableSearch' | 'enableThinking' {
    const metadata = span.metadata || {};
    
    if (metadata.searchEnabled || span.type === 'SEARCH') {
      return 'enableSearch';
    }
    
    return 'enableThinking';
  }

  // ==================== Private Helper Methods ====================

  /**
   * Language detection
   */
  private detectLanguage(text: string): string {
    for (const { pattern, language } of this.LANGUAGE_PATTERNS) {
      if (pattern.test(text)) {
        return language;
      }
    }
    return 'en'; // default
  }

  /**
   * query type 분석
   */
  private analyzeQueryType(query: string): string {
    const lowerQuery = query.toLowerCase();

    // 코드 관련
    if (
      query.includes('```') ||
      /코드|함수|클래스|code|function|class|debug|error|bug/i.test(lowerQuery)
    ) {
      return 'code';
    }

    // 검색 관련
    if (
      /검색|찾아|search|find|look up/i.test(lowerQuery)
    ) {
      return 'search';
    }

    // 번역 관련
    if (
      /번역|translate|English로|Korean로|Japanese로/i.test(lowerQuery)
    ) {
      return 'translation';
    }

    // 분석 관련
    if (
      /분석|analyze|설명|explain/i.test(lowerQuery)
    ) {
      return 'analysis';
    }

    return 'general';
  }

  /**
   * simple 쿼리인지 판단
   */
  private isSimpleQuery(query: string): boolean {
    // 짧은 쿼리
    if (query.length < 50) {
      return true;
    }

    // 단순 인사/감사
    if (/^(inside녕|hi|hello|thanks|감사|고마워)/i.test(query)) {
      return true;
    }

    // 단순 질문
    if (/^(뭐야|what is|who is|어디)/i.test(query) && query.length < 100) {
      return true;
    }

    return false;
  }

  /**
   * GlobalLearning에서 pattern 확인
   */
  private async checkGlobalLearningPatterns(query: string): Promise<{
    action: 'enableSearch' | 'enableThinking' | 'none';
    confidence: number;
  }> {
    try {
      const result = await this.globalLearning.findMatchingAction(query);
      if (result.action === 'enableSearch' || result.action === 'enableThinking') {
        return {
          action: result.action,
          confidence: result.confidence,
        };
      }
    } catch (error) {
      this.logger.warn('Failed to check GlobalLearning patterns:', error);
    }

    return { action: 'none', confidence: 0 };
  }

  // ==================== Global Learning Integration (Requirements: 4.6, 7.4) ====================

  /**
   * Learning result를 Global Learning에 적용
   * 
   * Redis에 저장된 Learning pattern을 GlobalLearning과 merges.
   * existing pattern during new pattern과 충돌하지 않는 것은 보존is done.
   * 
   * Property 15: pattern 병합 보존성
   * - existing pattern during new pattern과 충돌하지 않는 것은 보존되어야 does.
   * 
   * Requirements: 4.6, 7.4
   */
  async applyLearnings(): Promise<void> {
    try {
      // 1. Redis에서 learned pattern 조회
      const learnedPatterns = await this.getLearnedPatternsFromRedis();
      
      if (learnedPatterns.length === 0) {
        this.logger.debug('No learned patterns to apply');
        return;
      }

      // 2. 신뢰도 0.7 이상인 pattern만 filter링
      const qualifiedPatterns = learnedPatterns.filter(
        pattern => pattern.confidence >= AlgorithmService.CONFIDENCE_THRESHOLD
      );

      if (qualifiedPatterns.length === 0) {
        this.logger.debug('No patterns meet confidence threshold');
        return;
      }

      // 3. existing GlobalLearning pattern 조회
      const existingLearnings = await this.globalLearning.getLearnings();
      const existingPatterns = existingLearnings?.queryPatterns || [];

      // 4. pattern 병합 (existing pattern 보존)
      const mergedPatterns = this.mergePatterns(existingPatterns, qualifiedPatterns);

      // 5. GlobalLearning에 저장
      const updatedLearnings = {
        queryPatterns: mergedPatterns,
        errorFixes: existingLearnings?.errorFixes || [],
        commonQuestions: existingLearnings?.commonQuestions || [],
      };

      await this.globalLearning.saveLearnings(updatedLearnings);

      this.logger.log(
        `Applied ${qualifiedPatterns.length} learned patterns to GlobalLearning. ` +
        `Total patterns: ${mergedPatterns.length}`
      );
    } catch (error) {
      this.logger.error('Error applying learnings to GlobalLearning:', error);
    }
  }

  /**
   * Redis에서 learned pattern 조회
   * 
   * PATTERN_KEY_PREFIX로 start하는 모든 pattern을 retrieves.
   * Redis 장애 시 빈 array을 returns. (Requirements 8.6)
   */
  private async getLearnedPatternsFromRedis(): Promise<LearnedPattern[]> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available, cannot get learned patterns');
      return []; // 에러 throw not done (Requirements 8.6)
    }

    const patterns: LearnedPattern[] = [];

    try {
      // Redis SCAN을 사용하여 pattern key 조회
      const keys = await this.redis.scanKeys(`${AlgorithmService.PATTERN_KEY_PREFIX}*`);
      
      for (const key of keys) {
        const pattern = await this.redis.getJson<LearnedPattern>(key);
        if (pattern) {
          patterns.push(pattern);
        }
      }
    } catch (error) {
      this.logger.warn('Failed to get learned patterns from Redis (Redis may be unavailable):', error);
      // error 발생해도 AI service에 영향 없음 (Requirements 8.6)
    }

    return patterns;
  }

  /**
   * pattern 병합
   * 
   * existing pattern과 new pattern을 merges.
   * - 충돌하는 pattern: new pattern으로 업데이트 (신뢰도가 high case)
   * - 충돌하지 않는 pattern: existing pattern 보존
   * 
   * Property 15: pattern 병합 보존성
   * 
   * @param existingPatterns existing GlobalLearning pattern
   * @param newPatterns new로 learned pattern
   * @returns 병합된 pattern list
   */
  private mergePatterns(
    existingPatterns: QueryPattern[],
    newPatterns: LearnedPattern[],
  ): QueryPattern[] {
    // existing pattern을 Map으로 변환 (pattern string 기준)
    const patternMap = new Map<string, QueryPattern>();
    
    // 1. existing pattern 추가 (보존)
    for (const existing of existingPatterns) {
      patternMap.set(existing.pattern, existing);
    }

    // 2. new pattern 병합
    for (const newPattern of newPatterns) {
      // LearnedPattern에서 pattern string 추출 (queryType:xxx format에서 xxx 추출)
      const patternString = this.extractPatternString(newPattern.pattern);
      const action = this.determineActionFromPattern(newPattern);
      
      const existing = patternMap.get(patternString);
      
      if (existing) {
        // 충돌: 신뢰도가 더 high case에만 업데이트
        if (newPattern.confidence > existing.confidence) {
          patternMap.set(patternString, {
            pattern: patternString,
            action: action,
            confidence: newPattern.confidence,
            occurrences: existing.occurrences + newPattern.sampleCount,
          });
          
          this.logger.debug(
            `Updated pattern: ${patternString} (confidence: ${existing.confidence} -> ${newPattern.confidence})`
          );
        }
        // 신뢰도가 낮거나 같으면 existing pattern 보존 (Property 15)
      } else {
        // 충돌 없음: new pattern 추가
        patternMap.set(patternString, {
          pattern: patternString,
          action: action,
          confidence: newPattern.confidence,
          occurrences: newPattern.sampleCount,
        });
        
        this.logger.debug(`Added new pattern: ${patternString}`);
      }
    }

    // 3. Map을 array로 변환하고 신뢰도 순으로 정렬
    const mergedPatterns = Array.from(patternMap.values());
    mergedPatterns.sort((a, b) => b.confidence - a.confidence);

    // 4. max 100개 pattern 유지
    return mergedPatterns.slice(0, 100);
  }

  /**
   * LearnedPattern에서 pattern string 추출
   * 
   * "queryType:code:hasCode" -> "코드|함수|클래스|code|function|class"
   * "feature:hasCode" -> "```|code|코드"
   */
  private extractPatternString(patternKey: string): string {
    // pattern key에서 type 추출
    if (patternKey.startsWith('queryType:')) {
      const queryType = patternKey.replace('queryType:', '').split(':')[0];
      return this.getPatternForQueryType(queryType);
    }
    
    if (patternKey.startsWith('feature:')) {
      const feature = patternKey.replace('feature:', '').split(':')[0];
      return this.getPatternForFeature(feature);
    }

    // default: pattern key 그대로 반환
    return patternKey;
  }

  /**
   * query type에 대한 pattern string 반환
   */
  private getPatternForQueryType(queryType: string): string {
    const patterns: Record<string, string> = {
      code: '코드|함수|클래스|버그|에러|code|function|class|bug|error|debug',
      search: '검색|찾아|search|find|look up',
      translation: '번역|translate|English로|Korean로|Japanese로',
      analysis: '분석|analyze|설명|explain',
      general: '일반|general',
    };

    return patterns[queryType] || queryType;
  }

  /**
   * 기능에 대한 pattern string 반환
   */
  private getPatternForFeature(feature: string): string {
    const patterns: Record<string, string> = {
      hasCode: '```|code|코드|function|함수',
      hasQuestion: '?|뭐|어떻게|왜|what|how|why',
    };

    return patterns[feature] || feature;
  }

  /**
   * LearnedPattern에서 액션 결정
   */
  private determineActionFromPattern(pattern: LearnedPattern): 'enableSearch' | 'enableThinking' | 'detectLanguage' | 'none' {
    const patternKey = pattern.pattern.toLowerCase();
    
    // 코드 관련 pattern은 thinking
    if (patternKey.includes('code') || patternKey.includes('hasCode')) {
      return 'enableThinking';
    }
    
    // 검색 관련 pattern
    if (patternKey.includes('search')) {
      return 'enableSearch';
    }
    
    // 번역 관련 pattern
    if (patternKey.includes('translation') || patternKey.includes('lang:')) {
      return 'detectLanguage';
    }
    
    // 분석 관련 pattern은 thinking
    if (patternKey.includes('analysis') || patternKey.includes('analyze')) {
      return 'enableThinking';
    }

    // default
    return 'none';
  }

  // ==================== A/B Testing (Requirements: 4.5) ====================

  /**
   * A/B test group 할당
   * 
   * 동일한 userId와 experimentId 조합에 대해 항상 동일한 group을 returns.
   * hash 기반 일관된 group 할당을 uses.
   * 
   * Property 14: A/B test group 할당 일관성
   * - 동일한 userId와 experimentId 조합에 대해 항상 동일한 group을 반환해야 does.
   * 
   * @param userId 사용자 ID
   * @param experimentId 실험 ID
   * @returns group 식별자 ('control' 또는 'treatment')
   * 
   * Requirements: 4.5
   */
  assignExperimentGroup(userId: string, experimentId: string): string {
    // 1. userId와 experimentId를 결합하여 고유 string 생성
    const combined = `${userId}:${experimentId}`;
    
    // 2. hash 함수를 사용하여 일관된 hashvalue 생성
    const hash = this.hashString(combined);
    
    // 3. hashvalue을 기반으로 group 결정 (2개 group: control, treatment)
    const groupIndex = hash % 2;
    const group = groupIndex === 0 ? 'control' : 'treatment';
    
    this.logger.debug(
      `Assigned experiment group: userId=${userId}, experimentId=${experimentId} -> ${group}`,
    );
    
    return group;
  }

  /**
   * string hash 함수 (djb2 알고리즘)
   * 
   * 일관된 hashvalue을 생성하여 동일한 입력에 대해 항상 동일한 출력을 보장does.
   * 
   * @param str hash할 string
   * @returns 양수 hashvalue
   */
  private hashString(str: string): number {
    let hash = 5381;
    
    for (let i = 0; i < str.length; i++) {
      // hash * 33 + char
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    
    // 항상 양수 반환
    return Math.abs(hash);
  }
}
