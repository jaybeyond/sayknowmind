import { Feedback } from './feedback.dto';
import { Span } from './span.dto';

/**
 * Algorithm Service DTOs
 * 
 * Data transfer objects used by AlgorithmService.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

/**
 * 쿼리 컨텍스트
 * model recommendation 시 참고할 컨텍스트 info
 */
export interface QueryContext {
  userId?: string;
  sessionId?: string;
  language?: string;
  previousModel?: string;
  queryType?: string;
}

/**
 * model recommendation 결과
 * 쿼리에 대한 최적 model recommendation info
 */
export interface ModelRecommendation {
  model: string;
  confidence: number;
  reason: string;
  alternatives: string[];
}

/**
 * feature recommendation 결과
 * 검색/사고 모드 자동 enabled 추천 info
 */
export interface FeatureRecommendation {
  enableSearch: boolean;
  enableThinking: boolean;
  confidence: number;
}

/**
 * Learned patterns
 * Pattern information learned by Algorithm Service
 */
export interface LearnedPattern {
  pattern: string;
  model: string;
  confidence: number;
  sampleCount: number;
  lastUpdated: string;
}

/**
 * learning result
 * pattern 학습 작업의 결과
 */
export interface LearnResult {
  patternsLearned: number;
  patternsApplied: number;
  timestamp: string;
}

/**
 * Feedback-Span link information
 * Used for feedback-based learning.
 * 
 * Requirements: 4.2, 4.4
 */
export interface FeedbackWithSpan {
  feedback: Feedback;
  span: Span;
}
