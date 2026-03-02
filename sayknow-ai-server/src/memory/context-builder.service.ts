import { Injectable, Logger } from '@nestjs/common';
import { UserMemoryService } from './user-memory.service';
import { SessionContextService } from './session-context.service';
import { GlobalLearningService } from './global-learning.service';
import { ChatMessage, BuiltContext } from './dto/memory.dto';

interface BuildContextParams {
  userId: string;
  sessionId: string;
  newMessage: string;
  systemPrompt?: string;
  customInstructions?: string;
}

interface MemoryContext {
  userMemorySummary: string | null;
  sessionSummary: string | null;
  recentTopics: string[];
  appliedPatterns: string[];
}

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private userMemory: UserMemoryService,
    private sessionContext: SessionContextService,
    private globalLearning: GlobalLearningService,
  ) {}

  /**
   * Build all Context based on AI call
   * 
   * Priority:
   * 1. System prompt (default rules)
   * 2. Persona (passed from backend)
   * 3. User custom instructions (passed from backend)
   * 4. User memory (Redis)
   * 5. Conversation summary (Redis)
   * 6. Recent messages (Redis)
   * 7. New message
   */
  async buildContext(params: BuildContextParams): Promise<BuiltContext> {
    const { userId, sessionId, newMessage, systemPrompt, customInstructions } = params;

    // 1. Get user memory
    const userMemorySummary = await this.userMemory.getMemorySummary(userId);

    // 2. Get session context
    const sessionCtx = await this.sessionContext.getContext(sessionId);
    const recentMessages = sessionCtx?.recentMessages || [];
    const sessionSummary = sessionCtx?.summary || '';
    const topics = sessionCtx?.topics || [];

    // 3. global learning에서 액션 찾기
    const { action, confidence, reason } = await this.globalLearning.findMatchingAction(newMessage);
    const appliedPatterns: string[] = [];
    if (action !== 'none' && confidence >= 0.7) {
      appliedPatterns.push(`${action} (confidence: ${confidence.toFixed(2)}, reason: ${reason})`);
    }

    // 4. 시스템 prompt 구성 (메모리 Context 포함)
    const finalSystemPrompt = this.buildSystemPrompt({
      basePrompt: systemPrompt,
      customInstructions,
      userMemorySummary,
      sessionSummary,
      topics,
    });

    // 5. 메시지 array 구성
    const messages: ChatMessage[] = [
      { role: 'system', content: finalSystemPrompt, timestamp: new Date().toISOString() },
      ...recentMessages,
      { role: 'user', content: newMessage, timestamp: new Date().toISOString() },
    ];

    this.logger.log(`📦 Built context: ${messages.length} messages, memory: ${!!userMemorySummary}, summary: ${!!sessionSummary}, topics: ${topics.length}`);

    return {
      systemPrompt: finalSystemPrompt,
      messages,
      userMemorySummary: userMemorySummary || undefined,
      sessionSummary: sessionSummary || undefined,
      appliedPatterns: appliedPatterns.length > 0 ? appliedPatterns : undefined,
    };
  }

  /**
   * 메모리 Context만 조회 (ai.controller.ts에서 사용)
   */
  async getMemoryContext(userId: string, sessionId: string): Promise<MemoryContext> {
    const userMemorySummary = await this.userMemory.getMemorySummary(userId);
    const sessionCtx = await this.sessionContext.getContext(sessionId);
    
    return {
      userMemorySummary,
      sessionSummary: sessionCtx?.summary || null,
      recentTopics: sessionCtx?.topics || [],
      appliedPatterns: [],
    };
  }

  /**
   * 시스템 prompt 구성 (메모리 Context 포함)
   */
  private buildSystemPrompt(params: {
    basePrompt?: string;
    customInstructions?: string;
    userMemorySummary?: string | null;
    sessionSummary?: string;
    topics?: string[];
  }): string {
    const parts: string[] = [];

    // 1. default 시스템 prompt 또는 persona
    if (params.basePrompt) {
      parts.push(params.basePrompt);
    } else {
      parts.push('당신은 SayKnowAI의 AI 어시스턴트is. 친절하고 도움이 되는 답변을 제공please do.');
    }

    // 2. 사용자 커스텀 지시
    if (params.customInstructions) {
      parts.push(`\n[사용자 지시사항]\n${params.customInstructions}`);
    }

    // 3. user memory (개인화된 response above해)
    if (params.userMemorySummary) {
      parts.push(`\n${params.userMemorySummary}`);
      parts.push('above user info를 참고하여 개인화된 response 제공please do.');
    }

    // 4. conversation summary (맥락 유지를 above해)
    if (params.sessionSummary) {
      parts.push(`\n[previous conversation summary]\n${params.sessionSummary}`);
    }

    // 5. current conversation topics
    if (params.topics && params.topics.length > 0) {
      parts.push(`\n[current conversation topics: ${params.topics.slice(0, 5).join(', ')}]`);
    }

    return parts.join('\n');
  }

  /**
   * 메모리 Context를 existing 시스템 prompt에 추가
   */
  async enrichSystemPrompt(
    userId: string,
    sessionId: string,
    baseSystemPrompt: string,
  ): Promise<string> {
    const memoryContext = await this.getMemoryContext(userId, sessionId);
    
    const parts: string[] = [baseSystemPrompt];
    
    // user memory 추가
    if (memoryContext.userMemorySummary) {
      parts.push(`\n${memoryContext.userMemorySummary}`);
    }
    
    // session summary 추가
    if (memoryContext.sessionSummary) {
      parts.push(`\n[previous conversation summary]\n${memoryContext.sessionSummary}`);
    }
    
    // conversation topics 추가
    if (memoryContext.recentTopics.length > 0) {
      parts.push(`\n[conversation topics: ${memoryContext.recentTopics.slice(0, 5).join(', ')}]`);
    }
    
    return parts.join('\n');
  }

  /**
   * 응답 after Context 업데이트
   */
  async updateAfterResponse(
    userId: string,
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    aiRouter?: any,
  ): Promise<{ needsSummary: boolean; context: { messageCount: number } }> {
    this.logger.log(`🔄 Updating memory: userId=${userId}, sessionId=${sessionId}`);
    
    // 1. 사용자 메시지 추가
    const userMsg: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    await this.sessionContext.addMessage(sessionId, userId, userMsg);

    // 2. 어시스턴트 응답 추가
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: assistantResponse,
      timestamp: new Date().toISOString(),
    };
    const { needsSummary, context } = await this.sessionContext.addMessage(sessionId, userId, assistantMsg);

    // 3. user info 추출 및 저장 (AI 추출 포함)
    const extracted = await this.userMemory.extractAndSaveFromConversation(
      userId,
      sessionId,
      userMessage,
      assistantResponse,
      context.messageCount,  // 메시지 수 before달
      aiRouter,              // AI 라우터 before달
    );

    // 4. 추출된 info 로깅
    if (Object.keys(extracted).some(k => extracted[k as keyof typeof extracted])) {
      this.logger.log(`🧠 Extracted user info: ${JSON.stringify(extracted)}`);
    }

    this.logger.log(`✅ Memory updated for session ${sessionId}`);
    return { needsSummary, context: { messageCount: context.messageCount } };
  }

  /**
   * Generate summary prompt (개선된 버before)
   */
  async generateSummaryPrompt(sessionId: string): Promise<string | null> {
    const history = await this.sessionContext.getFullHistory(sessionId);
    if (history.length < 6) return null;  // 6개부터 요약 start

    // existing 요약if present 점진적 업데이트
    const context = await this.sessionContext.getContext(sessionId);
    const existingSummary = context?.summary || '';
    
    // 요약 이after new 메시지만 추출
    const recentHistory = history.slice(-10);
    const conversationText = recentHistory
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.substring(0, 300)}`)
      .join('\n');

    if (existingSummary) {
      // 점진적 요약 업데이트
      return `existing conversation summary:
${existingSummary}

recent conversation:
${conversationText}

above existing 요약과 recent conversation를 통합하여 3-4문장으로 업데이트된 요약을 작성please do.
포함할 content: 주요 주제, 사용자 요청, 해결된 content, important information
JSON format 없이 자연스러운 문장으로 작성please do.`;
    }

    // new Generate summary
    return `next 대화를 3-4문장으로 요약please do.
포함할 content: 주요 주제, 사용자 요청, 해결된 content, important information

대화:
${conversationText}

요약:`;
  }

  /**
   * Save summary
   */
  async saveSummary(sessionId: string, summary: string): Promise<void> {
    await this.sessionContext.updateSummary(sessionId, summary);
  }

  /**
   * 검색/thinking 필요 whether 판단
   */
  async shouldEnableFeatures(message: string): Promise<{
    enableSearch: boolean;
    enableThinking: boolean;
  }> {
    const { action, confidence } = await this.globalLearning.findMatchingAction(message);
    
    return {
      enableSearch: action === 'enableSearch' && confidence >= 0.7,
      enableThinking: action === 'enableThinking' && confidence >= 0.7,
    };
  }

  /**
   * 피드백 학습 (사용자 만족도 기반)
   */
  async learnFromFeedback(
    query: string,
    action: 'enableSearch' | 'enableThinking',
    wasHelpful: boolean,
  ): Promise<void> {
    await this.globalLearning.learnFromFeedback(query, action, wasHelpful);
  }

  /**
   * new 세션인지 확인 (메시지 수 기반)
   */
  async isNewSession(sessionId: string): Promise<boolean> {
    const context = await this.sessionContext.getContext(sessionId);
    return !context || context.messageCount === 0;
  }

  /**
   * branding rules 가져오기 (매 요청마다 - stateless API 특성상 required)
   * @param language language code (ko, en, ja, zh, vi, th)
   * @returns branding rules string (압축 버before ~30 토large)
   */
  getBrandingRules(language?: string): string {
    // Language detection 또는 default
    const lang = language || 'ko';
    
    // 압축 버before 사용 (토large 효율적)
    return this.globalLearning.getCompactBrandingRule(lang);
  }

  /**
   * @deprecated Use getBrandingRulesIfNeeded instead (branding must be sent every request)
   */
  async getBrandingRulesIfNeeded(sessionId: string, language?: string): Promise<string | null> {
    // 이제 매번 branding rules을 before송해야 함 (stateless API)
    return this.getBrandingRules(language);
  }

  /**
   * Smart branding rules 가져오기
   * - 첫 대화: all branding rules
   * - 정체성 질문: 모델별 압축 branding rules
   * - General conversation: branding rules 없음 (토large 절약)
   * 
   * @param sessionId 세션 ID
   * @param message 사용자 메시지
   * @param language language code
   * @returns branding rules 또는 null
   */
  async getSmartBrandingRules(
    sessionId: string,
    message: string,
    language?: string,
  ): Promise<{ rules: string | null; isFirstMessage: boolean; isIdentityQuestion: boolean }> {
    const lang = language || this.detectLanguage(message);
    const isNew = await this.isNewSession(sessionId);
    const isIdentityQuestion = this.globalLearning.isIdentityQuestion(message);
    
    // 1. 첫 대화: all branding rules
    if (isNew) {
      const fullRules = await this.globalLearning.getBrandingRule(lang);
      this.logger.log(`🏷️ First message - applying full branding rules (${lang})`);
      return { rules: fullRules, isFirstMessage: true, isIdentityQuestion };
    }
    
    // 2. 정체성 질문: 모델별 압축 branding rules
    if (isIdentityQuestion) {
      const lastModel = await this.sessionContext.getLastModelUsed(sessionId);
      const modelRules = this.globalLearning.getModelSpecificBrandingRule(lastModel || '', lang);
      this.logger.log(`🏷️ Identity question detected - applying model-specific branding (model: ${lastModel})`);
      return { rules: modelRules, isFirstMessage: false, isIdentityQuestion: true };
    }
    
    // 3. General conversation: branding rules 없음 (토large 절약)
    this.logger.debug(`📝 Normal message - no branding rules needed`);
    return { rules: null, isFirstMessage: false, isIdentityQuestion: false };
  }

  /**
   * Model used 저장 (응답 after 호출)
   */
  async saveLastModelUsed(sessionId: string, modelUsed: string): Promise<void> {
    await this.sessionContext.updateLastModelUsed(sessionId, modelUsed);
  }

  /**
   * Language detection (simple 휴리스틱)
   */
  detectLanguage(text: string): string {
    // 한글
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
    // Japanese
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
    // during국어
    if (/[\u4E00-\u9FFF]/.test(text) && !/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'zh';
    // default: English
    return 'en';
  }
}
