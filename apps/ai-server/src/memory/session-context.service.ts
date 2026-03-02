import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import { SessionContext, ChatMessage } from './dto/memory.dto';

// AI model name filter링 pattern (save to memory 시 제거)
const MODEL_NAME_PATTERNS = [
  // Solar 계열
  /Solar\s*(Pro|Open|Mini)?\s*\d*B?/gi,
  /업스테이지|Upstage/gi,
  // Gemini/Google 계열
  /Gemini|제미나이|Google\s*AI|구글\s*AI/gi,
  // GPT/OpenAI 계열
  /GPT-?\d+\.?\d*|ChatGPT|OpenAI/gi,
  // Claude/Anthropic 계열
  /Claude|클로드|Anthropic/gi,
  // Qwen/Alibaba 계열
  /Qwen|queue웬|알리바바|Alibaba|Tongyi/gi,
  // GLM/Zhipu 계열
  /GLM-?\d*\.?\d*|ChatGLM|Zhipu|지푸/gi,
  // Llama/Meta 계열
  /Llama|LLaMA|Meta\s*AI|메타\s*AI/gi,
  // Step 계열
  /Step\s*\d+\.?\d*|StepFun/gi,
  // 기타
  /Mistral|Mixtral|DeepSeek|Cloudflare|Workers\s*AI/gi,
];

@Injectable()
export class SessionContextService {
  private readonly logger = new Logger(SessionContextService.name);
  private readonly CONTEXT_TTL_HOURS: number;
  private readonly HISTORY_TTL_DAYS: number;
  private readonly RECENT_MESSAGES_COUNT: number;
  private readonly SUMMARY_TRIGGER_COUNT: number;

  constructor(
    private redis: RedisService,
    private configService: ConfigService,
  ) {
    this.CONTEXT_TTL_HOURS = parseInt(this.configService.get('SESSION_CONTEXT_TTL_HOURS', '24'));
    this.HISTORY_TTL_DAYS = parseInt(this.configService.get('HISTORY_TTL_DAYS', '7'));
    this.RECENT_MESSAGES_COUNT = parseInt(this.configService.get('RECENT_MESSAGES_COUNT', '6'));
    this.SUMMARY_TRIGGER_COUNT = parseInt(this.configService.get('SUMMARY_TRIGGER_COUNT', '10'));
  }

  /**
   * AI 응답에서 model name 제거 (메모리 오염 방지)
   */
  private sanitizeModelNames(content: string): string {
    let sanitized = content;
    for (const pattern of MODEL_NAME_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }
    // 연속 공백 정리
    sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();
    return sanitized;
  }

  private getContextKey(sessionId: string): string {
    return `session:${sessionId}:context`;
  }

  private getHistoryKey(sessionId: string): string {
    return `session:${sessionId}:history`;
  }

  private getContextTTL(): number {
    return this.CONTEXT_TTL_HOURS * 60 * 60;
  }

  private getHistoryTTL(): number {
    return this.HISTORY_TTL_DAYS * 24 * 60 * 60;
  }

  /**
   * Get session context
   */
  async getContext(sessionId: string): Promise<SessionContext | null> {
    if (!this.redis.isReady()) return null;

    const context = await this.redis.getJson<SessionContext>(this.getContextKey(sessionId));
    if (context) {
      await this.redis.expire(this.getContextKey(sessionId), this.getContextTTL());
    }
    return context;
  }

  /**
   * Save session context
   */
  async saveContext(sessionId: string, context: SessionContext): Promise<void> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not ready, skipping session context save');
      return;
    }
    
    context.lastActivity = new Date().toISOString();
    await this.redis.setJson(this.getContextKey(sessionId), context, this.getContextTTL());
    this.logger.log(`💾 Saved session context: ${sessionId}, messages: ${context.messageCount}`);
  }

  /**
   * 메시지 추가 및 Context 업데이트
   */
  async addMessage(
    sessionId: string,
    userId: string,
    message: ChatMessage,
  ): Promise<{ needsSummary: boolean; context: SessionContext }> {
    // existing Context 조회 또는 생성
    let context = await this.getContext(sessionId) || this.createEmptyContext(userId);

    // AI 응답에서 model name 제거 (메모리 오염 방지)
    const sanitizedMessage = { ...message };
    if (message.role === 'assistant') {
      sanitizedMessage.content = this.sanitizeModelNames(message.content);
      if (sanitizedMessage.content !== message.content) {
        this.logger.debug(`🧹 Sanitized model names from assistant response`);
      }
    }

    // 메시지 추가
    context.recentMessages.push(sanitizedMessage);
    context.messageCount++;

    // 최근 N개만 유지
    if (context.recentMessages.length > this.RECENT_MESSAGES_COUNT) {
      context.recentMessages = context.recentMessages.slice(-this.RECENT_MESSAGES_COUNT);
    }

    // all 히스토리에도 저장
    await this.addToHistory(sessionId, sanitizedMessage);

    // 토픽 추출 (개선된 버before)
    if (message.role === 'user') {
      const newTopics = this.extractTopics(message.content);
      context.topics = this.mergeTopics(context.topics, newTopics);
      
      // key 포인트 추출 (important information)
      const keyPoint = this.extractKeyPoint(message.content);
      if (keyPoint) {
        context.keyPoints = this.mergeKeyPoints(context.keyPoints, keyPoint);
      }
    }

    await this.saveContext(sessionId, context);

    // 요약 필요 whether 확인 (6개 메시지마다 - 더 자주 요약)
    const needsSummary = context.messageCount >= 6 && context.messageCount % 6 === 0;

    return { needsSummary, context };
  }

  /**
   * all 히스토리에 메시지 추가
   */
  private async addToHistory(sessionId: string, message: ChatMessage): Promise<void> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not ready, skipping history save');
      return;
    }
    
    await this.redis.rpush(this.getHistoryKey(sessionId), JSON.stringify(message));
    await this.redis.expire(this.getHistoryKey(sessionId), this.getHistoryTTL());
    this.logger.debug(`📜 Added to history: ${sessionId}, role: ${message.role}`);
  }

  /**
   * all 히스토리 조회 (Generate summary용)
   */
  async getFullHistory(sessionId: string): Promise<ChatMessage[]> {
    if (!this.redis.isReady()) return [];

    const history = await this.redis.lrange(this.getHistoryKey(sessionId), 0, -1);
    return history.map(h => JSON.parse(h) as ChatMessage);
  }

  /**
   * 요약 업데이트
   */
  async updateSummary(sessionId: string, summary: string): Promise<void> {
    const context = await this.getContext(sessionId);
    if (context) {
      context.summary = summary;
      context.summaryUpdatedAt = new Date().toISOString();
      await this.saveContext(sessionId, context);
      this.logger.log(`📝 Updated summary for session ${sessionId}`);
    }
  }

  /**
   * Model used 업데이트 (브랜딩용)
   */
  async updateLastModelUsed(sessionId: string, modelUsed: string): Promise<void> {
    const context = await this.getContext(sessionId);
    if (context) {
      context.lastModelUsed = modelUsed;
      await this.saveContext(sessionId, context);
      this.logger.debug(`🤖 Updated lastModelUsed for session ${sessionId}: ${modelUsed}`);
    }
  }

  /**
   * last model used 조회
   */
  async getLastModelUsed(sessionId: string): Promise<string | null> {
    const context = await this.getContext(sessionId);
    return context?.lastModelUsed || null;
  }

  /**
   * Get recent messages (prompt용)
   */
  async getRecentMessages(sessionId: string, count?: number): Promise<ChatMessage[]> {
    const context = await this.getContext(sessionId);
    if (!context) return [];

    const limit = count || this.RECENT_MESSAGES_COUNT;
    return context.recentMessages.slice(-limit);
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    await this.redis.del(this.getContextKey(sessionId));
    await this.redis.del(this.getHistoryKey(sessionId));
    this.logger.log(`🗑️ Deleted session ${sessionId}`);
  }

  /**
   * 세션 Context Generate summary (prompt용)
   */
  async getContextSummary(sessionId: string): Promise<string | null> {
    const context = await this.getContext(sessionId);
    if (!context) return null;

    const parts: string[] = [];

    // conversation summaryif present 포함
    if (context.summary) {
      parts.push(`previous conversation summary: ${context.summary}`);
    }

    // 주요 토픽
    if (context.topics.length > 0) {
      parts.push(`conversation topics: ${context.topics.slice(0, 5).join(', ')}`);
    }

    // 대화 통계
    if (context.messageCount > 0) {
      parts.push(`대화 횟수: ${context.messageCount}회`);
    }

    if (parts.length === 0) return null;
    
    return `[세션 Context]\n${parts.join('\n')}`;
  }

  /**
   * 토픽 추출 (개선된 버before)
   */
  private extractTopics(content: string): string[] {
    const found: string[] = [];
    const lowerContent = content.toLowerCase();
    
    // 기술 토픽
    const techTopics: Record<string, string[]> = {
      '웹개발': ['react', 'vue', 'angular', 'next.js', 'html', 'css', 'javascript', 'typescript', 'frontend', '프론트엔드'],
      '백엔드': ['node.js', 'express', 'nestjs', 'django', 'flask', 'spring', 'api', 'rest', 'graphql', '백엔드', 'backend'],
      'data베이스': ['sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'data베이스', 'database'],
      'AI/ML': ['ai', 'ml', '머신러닝', '딥러닝', 'gpt', 'llm', 'machine learning', 'deep learning', '인공지능'],
      '모바일': ['ios', 'android', 'swift', 'kotlin', 'flutter', 'react native', '앱개발', 'mobile'],
      'DevOps': ['docker', 'kubernetes', 'aws', 'gcp', 'azure', 'ci/cd', 'devops', '클라우드'],
      '코딩': ['코드', '함수', '클래스', '버그', '에러', 'debugging', 'code', 'function', 'debug', 'error'],
    };
    
    // 일반 토픽
    const generalTopics: Record<string, string[]> = {
      '날씨': ['날씨', '기온', '비', '눈', '맑', '흐림', 'weather'],
      '여행': ['여행', '관광', '호텔', '비행기', 'travel', 'trip'],
      '음식': ['음식', '요리', '맛집', '레시피', 'food', 'recipe', 'restaurant'],
      '건강': ['건강', '운동', '다이어트', '병원', 'health', 'exercise', 'fitness'],
      '업무': ['업무', '회의', '프로젝트', '일정', 'work', 'meeting', 'project', 'schedule'],
      '학습': ['공부', '학습', '강의', '책', 'study', 'learn', 'course', 'book'],
    };
    
    const allTopics = { ...techTopics, ...generalTopics };
    
    for (const [topic, keywords] of Object.entries(allTopics)) {
      if (keywords.some(k => lowerContent.includes(k))) {
        found.push(topic);
      }
    }

    return found.slice(0, 5);
  }

  /**
   * 토픽 병합 (최근 것 우선, max 10개)
   */
  private mergeTopics(existing: string[], newTopics: string[]): string[] {
    // new 토픽을 앞에 추가하고 during복 제거
    const merged = [...new Set([...newTopics, ...existing])];
    return merged.slice(0, 10);
  }

  /**
   * key 포인트 추출 (important information)
   */
  private extractKeyPoint(content: string): string | null {
    // important information pattern
    const keyPointPatterns = [
      // 숫자/date info
      /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,  // date
      /(\d+(?:시|분|초|일|월|년|개|번|원|달러|엔))/,  // 숫자+단above
      // name/제목
      /(?:name은?|called?|named?) ["']?([^"'\n]{2,30})["']?/i,
      // URL/링크
      /(https?:\/\/[^\s]+)/,
      // 코드/명령어
      /`([^`]{3,50})`/,
      // during요 keyword
      /(?:during요|important|핵심|key|반드시|must)[:\s]*([^.!?\n]{5,100})/i,
    ];
    
    for (const pattern of keyPointPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim().substring(0, 100);
      }
    }
    
    return null;
  }

  /**
   * key 포인트 병합 (max 20개, during복 제거)
   */
  private mergeKeyPoints(existing: string[], newPoint: string): string[] {
    // 유사한 key 포인트 제거
    const isDuplicate = existing.some(p => 
      p.toLowerCase().includes(newPoint.toLowerCase()) ||
      newPoint.toLowerCase().includes(p.toLowerCase())
    );
    
    if (isDuplicate) return existing;
    
    return [...existing, newPoint].slice(-20);  // 최근 20개 유지
  }

  private createEmptyContext(userId: string): SessionContext {
    return {
      userId,
      summary: '',
      recentMessages: [],
      messageCount: 0,
      topics: [],
      keyPoints: [],
      lastActivity: new Date().toISOString(),
    };
  }
}
