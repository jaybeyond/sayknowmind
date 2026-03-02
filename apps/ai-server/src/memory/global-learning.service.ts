import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import { GlobalLearnings, QueryPattern, ErrorFix, CommonQuestion } from './dto/memory.dto';

interface ActionResult {
  action: 'enableSearch' | 'enableThinking' | 'detectLanguage' | 'none';
  confidence: number;
  reason?: string;
}

// Default branding rules (used when not in Redis) - strong version (for first conversation)
const DEFAULT_BRANDING_RULES: Record<string, string> = {
  ko: `[Branding rules - for reference, user persona takes priority]
Your default name is "SayKnow AI". If the user has set a persona, follow that persona.
Do not mention other AI models or company names (Google, OpenAI, Anthropic, Meta, Qwen, Solar, etc).`,
  en: `[Branding Rule - Reference only, user persona takes priority]
Your default name is "SayKnow AI". If the user has set a persona, follow that persona.
Do not mention other AI model or company names (Google, OpenAI, Anthropic, Meta, Qwen, Solar, etc).`,
  ja: `[ブランディングルール - 参考用、ユーザーペルソナ優先]
デフォルト名は「SayKnow AI」です。ユーザーがペルソナを設定している場合はそれに従ってください。
他のAIモデルや会社名を言及しないでください。`,
  zh: `[品牌规则 - 仅供参考，用户角色优先]
你的默认名称是"SayKnow AI"。如果用户设置了角色，请遵循该角色设定。
不要提及其他AI模型或公司名称（Google、OpenAI、Anthropic、Meta、Qwen、Solar等）。`,
};

// Compact branding rules (sent with every request - token efficient, ~30 tokens)
const COMPACT_BRANDING_RULES: Record<string, string> = {
  ko: '[Default name: SayKnow AI. User persona priority. Do not mention other AI names]',
  en: '[Default name: SayKnow AI. User persona takes priority. Do not mention other AI names]',
  ja: '[デフォルト名: SayKnow AI. ユーザーペルソナ優先. 他のAI名禁止]',
  zh: '[默认名称: SayKnow AI. 用户角色优先. 禁止提及其他AI名称]',
  vi: '[Tên mặc định: SayKnow AI. Ưu tiên persona người dùng. Không đề cập tên AI khác]',
  th: '[ชื่อเริ่มต้น: SayKnow AI. ให้ความสำคัญกับ persona ผู้ใช้. ห้ามกล่าวถึงชื่อ AI อื่น]',
};

// Model-specific compact branding rules (prohibit only specific model names - more efficient)
const MODEL_SPECIFIC_BRANDING: Record<string, Record<string, string>> = {
  'solar': {
    ko: '[Default name: SayKnow AI. Never mention Solar/Upstage. User persona priority]',
    en: '[Default: SayKnow AI. Never mention Solar/Upstage. User persona priority]',
  },
  'gemini': {
    ko: '[Default name: SayKnow AI. Never mention Google/Gemini. User persona priority]',
    en: '[Default: SayKnow AI. Never mention Google/Gemini. User persona priority]',
  },
  'qwen': {
    ko: '[Default name: SayKnow AI. Never mention Qwen/Alibaba. User persona priority]',
    en: '[Default: SayKnow AI. Never mention Qwen/Alibaba. User persona priority]',
  },
  // GLM series
  'glm': {
    ko: '[Default name: SayKnow AI. Never mention GLM/Zhipu/ChatGLM. User persona priority]',
    en: '[Default: SayKnow AI. Never mention GLM/Zhipu/ChatGLM. User persona priority]',
  },
  // Step series
  'step': {
    ko: '[Default name: SayKnow AI. Never mention Step/StepFun. User persona priority]',
    en: '[Default: SayKnow AI. Never mention Step/StepFun. User persona priority]',
  },
  // Llama series
  'llama': {
    ko: '[Default name: SayKnow AI. Never mention Llama/Meta. User persona priority]',
    en: '[Default: SayKnow AI. Never mention Llama/Meta. User persona priority]',
  },
};

// Identity question patterns (multilingual)
const IDENTITY_QUESTION_PATTERNS = [
  // Korean
  /너\s*(는|가)?\s*(누구|뭐야|뭔데|어떤|무슨)/i,
  /넌?\s*(누구|뭐야|뭔데)/i,
  /당신(은|이)?\s*(누구|뭐|어떤)/i,
  /어떤\s*(ai|모델|인공지능)/i,
  /무슨\s*(ai|모델|인공지능)/i,
  /(gemini|제미나이|구글|google)\s*(이야|야|니|맞|아니)/i,
  /(solar|솔라|업스테이지|upstage)\s*(이야|야|니|맞|아니)/i,
  /(gpt|chatgpt|openai)\s*(이야|야|니|맞|아니)/i,
  /(claude|클로드|anthropic)\s*(이야|야|니|맞|아니)/i,
  /(qwen|queue웬|알리바바)\s*(이야|야|니|맞|아니)/i,
  /정체(가|를|는)?/i,
  /뭘로\s*만들어/i,
  /어디서\s*만들/i,
  // English
  /who\s*(are\s*you|r\s*u)/i,
  /what\s*(are\s*you|r\s*u)/i,
  /are\s*you\s*(gemini|gpt|claude|solar|qwen|llama)/i,
  /which\s*(ai|model|llm)/i,
  /what\s*(ai|model|llm)\s*(are|r)\s*you/i,
  /your\s*(identity|name)/i,
  /made\s*by\s*(google|openai|anthropic|meta)/i,
  // Japanese
  /あなた(は|って)?(誰|何|どんな)/i,
  /何の(ai|モデル)/i,
  // Chinese
  /你是(谁|什么|哪个)/i,
  /什么(ai|模型)/i,
];

@Injectable()
export class GlobalLearningService implements OnModuleInit {
  private readonly logger = new Logger(GlobalLearningService.name);
  private readonly LEARNINGS_KEY = 'global:learnings';
  private readonly BRANDING_KEY = 'global:branding';
  private readonly STATS_KEY = 'global:stats';
  private readonly MIN_CONFIDENCE: number;
  private enabled: boolean;

  // default pattern (initialization용) - 확장된 버before
  private readonly defaultPatterns: QueryPattern[] = [
    // search needed pattern
    { pattern: '날씨|기온|비|눈|맑|흐림|weather|forecast|오늘 날씨', action: 'enableSearch', confidence: 0.95, occurrences: 0 },
    { pattern: '뉴스|소식|news|latest|latest|속보', action: 'enableSearch', confidence: 0.9, occurrences: 0 },
    { pattern: '주가|주식|stock|price|시세|환율', action: 'enableSearch', confidence: 0.9, occurrences: 0 },
    { pattern: '검색해|찾아봐|search for|look up|알아봐', action: 'enableSearch', confidence: 0.95, occurrences: 0 },
    { pattern: 'current|지금|오늘|최근|요즘', action: 'enableSearch', confidence: 0.6, occurrences: 0 },
    { pattern: '어디서|어디에|where|location|장소|맛집|추천', action: 'enableSearch', confidence: 0.7, occurrences: 0 },
    { pattern: '가격|비용|얼마|how much|price', action: 'enableSearch', confidence: 0.75, occurrences: 0 },
    
    // Thinking 필요 pattern
    { pattern: '코드|함수|클래스|버그|에러|code|function|class|bug|error|debug', action: 'enableThinking', confidence: 0.85, occurrences: 0 },
    { pattern: '분석|analyze|analysis|설명해|explain|왜|why', action: 'enableThinking', confidence: 0.8, occurrences: 0 },
    { pattern: '비교|compare|차이|difference|장단점', action: 'enableThinking', confidence: 0.8, occurrences: 0 },
    { pattern: '설계|design|아key텍처|architecture|structure', action: 'enableThinking', confidence: 0.85, occurrences: 0 },
    { pattern: '최적화|optimize|성능|performance|개선', action: 'enableThinking', confidence: 0.8, occurrences: 0 },
    { pattern: '알고리즘|algorithm|로직|logic|구현', action: 'enableThinking', confidence: 0.85, occurrences: 0 },
    { pattern: '문제|problem|해결|solve|solution', action: 'enableThinking', confidence: 0.75, occurrences: 0 },
    
    // Language detection pattern
    { pattern: '번역|translate|translation|English로|Korean로|Japanese로', action: 'detectLanguage', confidence: 0.9, occurrences: 0 },
    { pattern: 'in english|in korean|in japanese|in chinese', action: 'detectLanguage', confidence: 0.9, occurrences: 0 },
  ];

  constructor(
    private redis: RedisService,
    private configService: ConfigService,
  ) {
    this.enabled = this.configService.get('ENABLE_GLOBAL_LEARNING', 'true') === 'true';
    this.MIN_CONFIDENCE = parseFloat(this.configService.get('MIN_PATTERN_CONFIDENCE', '0.7'));
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('⚠️ Global learning disabled');
      return;
    }

    await this.initializeDefaultPatterns();
    await this.initializeBrandingRules();
  }

  private async initializeDefaultPatterns(): Promise<void> {
    if (!this.redis.isReady()) return;

    const existing = await this.getLearnings();
    if (!existing || existing.queryPatterns.length === 0) {
      const learnings: GlobalLearnings = {
        queryPatterns: this.defaultPatterns,
        errorFixes: [],
        commonQuestions: [],
      };
      await this.saveLearnings(learnings);
      this.logger.log('✅ Initialized default learning patterns');
    }
  }

  /**
   * branding rules initialization (항상 latest 규칙으로 업데이트)
   */
  private async initializeBrandingRules(): Promise<void> {
    if (!this.redis.isReady()) return;

    // 항상 latest branding rules으로 업데이트 (강력한 규칙 적용)
    await this.redis.setJson(this.BRANDING_KEY, DEFAULT_BRANDING_RULES);
    this.logger.log('✅ Updated branding rules in Redis (강력한 버before)');
  }

  /**
   * Get branding rules (언어별) - all 버before (첫 대화용)
   */
  async getBrandingRule(language: string = 'ko'): Promise<string> {
    if (!this.redis.isReady()) {
      return DEFAULT_BRANDING_RULES[language] || DEFAULT_BRANDING_RULES['en'];
    }

    const rules = await this.redis.getJson<Record<string, string>>(this.BRANDING_KEY);
    if (rules && rules[language]) {
      return rules[language];
    }
    
    return DEFAULT_BRANDING_RULES[language] || DEFAULT_BRANDING_RULES['en'];
  }

  /**
   * 압축된 Get branding rules (매 요청마다 before송용 - 토large 효율적)
   */
  getCompactBrandingRule(language: string = 'ko'): string {
    return COMPACT_BRANDING_RULES[language] || COMPACT_BRANDING_RULES['en'];
  }

  /**
   * 정체성 질문인지 감지
   */
  isIdentityQuestion(message: string): boolean {
    return IDENTITY_QUESTION_PATTERNS.some(pattern => pattern.test(message));
  }

  /**
   * 모델별 압축 Get branding rules (특정 model name만 금지)
   * @param modelUsed Model used name (예: 'solar-pro', 'gemini-2.5-flash')
   * @param language language code
   */
  getModelSpecificBrandingRule(modelUsed: string, language: string = 'ko'): string | null {
    if (!modelUsed) return null;
    
    const lowerModel = modelUsed.toLowerCase();
    
    // model name에서 key 추출
    for (const [key, rules] of Object.entries(MODEL_SPECIFIC_BRANDING)) {
      if (lowerModel.includes(key)) {
        return rules[language] || rules['en'] || null;
      }
    }
    
    // 매칭되는 모델if not present 일반 압축 규칙 반환
    return this.getCompactBrandingRule(language);
  }

  /**
   * branding rules 업데이트 (관리자용)
   */
  async updateBrandingRule(language: string, rule: string): Promise<void> {
    if (!this.redis.isReady()) return;

    const rules = await this.redis.getJson<Record<string, string>>(this.BRANDING_KEY) || {};
    rules[language] = rule;
    await this.redis.setJson(this.BRANDING_KEY, rules);
    this.logger.log(`✅ Updated branding rule for ${language}`);
  }

  /**
   * 모든 Get branding rules (관리자용)
   */
  async getAllBrandingRules(): Promise<Record<string, string>> {
    if (!this.redis.isReady()) {
      return DEFAULT_BRANDING_RULES;
    }

    const rules = await this.redis.getJson<Record<string, string>>(this.BRANDING_KEY);
    return rules || DEFAULT_BRANDING_RULES;
  }

  /**
   * learning data 조회
   */
  async getLearnings(): Promise<GlobalLearnings | null> {
    if (!this.redis.isReady()) return null;
    return this.redis.getJson<GlobalLearnings>(this.LEARNINGS_KEY);
  }

  /**
   * Save learning data
   */
  async saveLearnings(learnings: GlobalLearnings): Promise<void> {
    if (!this.redis.isReady()) return;
    await this.redis.setJson(this.LEARNINGS_KEY, learnings);
  }

  /**
   * 쿼리에 맞는 액션 찾기 (개선된 버before)
   */
  async findMatchingAction(query: string): Promise<ActionResult> {
    if (!this.enabled) return { action: 'none', confidence: 0 };

    const learnings = await this.getLearnings();
    if (!learnings) return { action: 'none', confidence: 0 };

    const lowerQuery = query.toLowerCase();
    let bestMatch: ActionResult = { action: 'none', confidence: 0 };

    // 1. Pattern matching
    for (const pattern of learnings.queryPatterns) {
      if (pattern.confidence < this.MIN_CONFIDENCE) continue;

      const regex = new RegExp(pattern.pattern, 'i');
      if (regex.test(lowerQuery)) {
        // 여러 pattern이 매칭될 case 가장 high confidence optional
        if (pattern.confidence > bestMatch.confidence) {
          bestMatch = { 
            action: pattern.action, 
            confidence: pattern.confidence,
            reason: `Matched pattern: ${pattern.pattern.substring(0, 30)}...`
          };
        }
        // 사용 횟수 증가 (async)
        this.incrementPatternUsage(pattern.pattern).catch(() => {});
      }
    }

    // 2. semantic 판단 (Pattern matching on failure)
    if (bestMatch.action === 'none') {
      bestMatch = this.analyzeQueryIntent(query);
    }

    if (bestMatch.action !== 'none') {
      this.logger.debug(`🎯 Action detected: ${bestMatch.action} (${bestMatch.confidence}) - ${bestMatch.reason}`);
    }

    return bestMatch;
  }

  /**
   * semantic 쿼리 분석
   */
  private analyzeQueryIntent(query: string): ActionResult {
    const lowerQuery = query.toLowerCase();
    
    // 검색이 필요한 질문 유형
    const searchIndicators = [
      { keywords: ['몇', '얼마', '언제', 'when', 'how much', 'how many'], weight: 0.6 },
      { keywords: ['어디', 'where', 'location', 'location'], weight: 0.7 },
      { keywords: ['누구', 'who', '사람'], weight: 0.5 },
      { keywords: ['latest', 'latest', 'recent', '요즘', 'current'], weight: 0.7 },
      { keywords: ['?', '알려줘', '알아봐', '찾아'], weight: 0.4 },
    ];
    
    // Thinking이 필요한 질문 유형
    const thinkingIndicators = [
      { keywords: ['왜', 'why', '이유', 'reason'], weight: 0.7 },
      { keywords: ['어떻게', 'how', 'method', 'method'], weight: 0.6 },
      { keywords: ['차이', 'difference', '비교', 'compare', 'vs'], weight: 0.8 },
      { keywords: ['장단점', 'pros', 'cons', '좋은점', '나쁜점'], weight: 0.8 },
      { keywords: ['설명', 'explain', '이해', 'understand'], weight: 0.6 },
      { keywords: ['```', 'code', '코드', 'function', '함수'], weight: 0.85 },
    ];
    
    let searchScore = 0;
    let thinkingScore = 0;
    
    for (const { keywords, weight } of searchIndicators) {
      if (keywords.some(k => lowerQuery.includes(k))) {
        searchScore = Math.max(searchScore, weight);
      }
    }
    
    for (const { keywords, weight } of thinkingIndicators) {
      if (keywords.some(k => lowerQuery.includes(k))) {
        thinkingScore = Math.max(thinkingScore, weight);
      }
    }
    
    // 코드 블록if present thinking 우선
    if (query.includes('```')) {
      thinkingScore = Math.max(thinkingScore, 0.9);
    }
    
    // 질문 길이가 길면 thinking 가during치 증가
    if (query.length > 100) {
      thinkingScore += 0.1;
    }
    
    if (thinkingScore > searchScore && thinkingScore >= this.MIN_CONFIDENCE) {
      return { action: 'enableThinking', confidence: Math.min(thinkingScore, 0.95), reason: 'Semantic analysis' };
    }
    
    if (searchScore >= this.MIN_CONFIDENCE) {
      return { action: 'enableSearch', confidence: Math.min(searchScore, 0.95), reason: 'Semantic analysis' };
    }
    
    return { action: 'none', confidence: 0 };
  }

  /**
   * pattern 사용 횟수 증가
   */
  private async incrementPatternUsage(pattern: string): Promise<void> {
    const learnings = await this.getLearnings();
    if (!learnings) return;

    const index = learnings.queryPatterns.findIndex(p => p.pattern === pattern);
    if (index >= 0) {
      learnings.queryPatterns[index].occurrences++;
      
      // 자주 사용되는 pattern의 confidence 약간 증가
      if (learnings.queryPatterns[index].occurrences % 10 === 0) {
        learnings.queryPatterns[index].confidence = Math.min(
          0.99, 
          learnings.queryPatterns[index].confidence + 0.01
        );
      }
      
      await this.saveLearnings(learnings);
    }
  }

  /**
   * new Pattern learning
   */
  async learnPattern(
    pattern: string,
    action: 'enableSearch' | 'enableThinking' | 'detectLanguage',
    initialConfidence: number = 0.7,
  ): Promise<void> {
    if (!this.enabled) return;

    const learnings = await this.getLearnings() || {
      queryPatterns: [],
      errorFixes: [],
      commonQuestions: [],
    };

    const existing = learnings.queryPatterns.find(p => p.pattern === pattern);
    if (existing) {
      existing.confidence = Math.min(0.99, existing.confidence + 0.05);
      existing.occurrences++;
    } else {
      learnings.queryPatterns.push({
        pattern,
        action,
        confidence: initialConfidence,
        occurrences: 1,
      });
    }

    // max 100개 pattern 유지
    if (learnings.queryPatterns.length > 100) {
      learnings.queryPatterns.sort((a, b) => 
        (b.confidence * b.occurrences) - (a.confidence * a.occurrences)
      );
      learnings.queryPatterns = learnings.queryPatterns.slice(0, 100);
    }

    await this.saveLearnings(learnings);
    this.logger.log(`📚 Learned pattern: ${pattern} → ${action}`);
  }

  /**
   * Feedback-based learning (user 검색/thinking Result에 만족했는지)
   */
  async learnFromFeedback(
    query: string,
    action: 'enableSearch' | 'enableThinking',
    wasHelpful: boolean,
  ): Promise<void> {
    if (!this.enabled) return;

    const learnings = await this.getLearnings();
    if (!learnings) return;

    // 해당 쿼리와 매칭되는 pattern 찾기
    for (const pattern of learnings.queryPatterns) {
      const regex = new RegExp(pattern.pattern, 'i');
      if (regex.test(query) && pattern.action === action) {
        // in feedback 따라 confidence 조정
        if (wasHelpful) {
          pattern.confidence = Math.min(0.99, pattern.confidence + 0.02);
        } else {
          pattern.confidence = Math.max(0.5, pattern.confidence - 0.05);
        }
        break;
      }
    }

    await this.saveLearnings(learnings);
  }

  /**
   * 에러 수정 Pattern learning
   */
  async learnErrorFix(error: string, fix: string): Promise<void> {
    if (!this.enabled) return;

    const learnings = await this.getLearnings() || {
      queryPatterns: [],
      errorFixes: [],
      commonQuestions: [],
    };

    const existing = learnings.errorFixes.find(e => e.error === error);
    if (existing) {
      existing.occurrences++;
      if (fix.length > existing.fix.length) {
        existing.fix = fix;
      }
    } else {
      learnings.errorFixes.push({ error, fix, occurrences: 1 });
    }

    // max 100개 유지
    if (learnings.errorFixes.length > 100) {
      learnings.errorFixes.sort((a, b) => b.occurrences - a.occurrences);
      learnings.errorFixes = learnings.errorFixes.slice(0, 100);
    }

    await this.saveLearnings(learnings);
    this.logger.log(`🔧 Learned error fix: ${error.substring(0, 50)}...`);
  }

  /**
   * 에러에 대한 수정 method 찾기
   */
  async findErrorFix(error: string): Promise<string | null> {
    if (!this.enabled) return null;

    const learnings = await this.getLearnings();
    if (!learnings) return null;

    const lowerError = error.toLowerCase();
    
    for (const ef of learnings.errorFixes) {
      if (ef.occurrences >= 3 && lowerError.includes(ef.error.toLowerCase())) {
        return ef.fix;
      }
    }

    return null;
  }

  /**
   * 자주 묻는 질문 학습
   */
  async learnCommonQuestion(question: string, answer: string): Promise<void> {
    if (!this.enabled) return;

    const learnings = await this.getLearnings() || {
      queryPatterns: [],
      errorFixes: [],
      commonQuestions: [],
    };

    const existing = learnings.commonQuestions.find(q => 
      this.calculateSimilarity(q.question, question) > 0.7
    );

    if (existing) {
      existing.frequency++;
      if (answer.length > existing.answer.length) {
        existing.answer = answer;
      }
    } else {
      learnings.commonQuestions.push({ question, answer, frequency: 1 });
    }

    // max 50개 유지
    if (learnings.commonQuestions.length > 50) {
      learnings.commonQuestions.sort((a, b) => b.frequency - a.frequency);
      learnings.commonQuestions = learnings.commonQuestions.slice(0, 50);
    }

    await this.saveLearnings(learnings);
  }

  /**
   * 자주 묻는 질문에서 답변 찾기
   */
  async findCommonAnswer(question: string): Promise<string | null> {
    if (!this.enabled) return null;

    const learnings = await this.getLearnings();
    if (!learnings) return null;

    for (const cq of learnings.commonQuestions) {
      if (cq.frequency >= 5) {
        const similarity = this.calculateSimilarity(question, cq.question);
        if (similarity > 0.8) {
          return cq.answer;
        }
      }
    }

    return null;
  }

  /**
   * 통계 조회
   */
  async getStats(): Promise<{
    totalPatterns: number;
    totalErrorFixes: number;
    totalCommonQuestions: number;
    topPatterns: QueryPattern[];
  } | null> {
    const learnings = await this.getLearnings();
    if (!learnings) return null;

    return {
      totalPatterns: learnings.queryPatterns.length,
      totalErrorFixes: learnings.errorFixes.length,
      totalCommonQuestions: learnings.commonQuestions.length,
      topPatterns: learnings.queryPatterns
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, 10),
    };
  }

  /**
   * simple 유사도 계산
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }
}
