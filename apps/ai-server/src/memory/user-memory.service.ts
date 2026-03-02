import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import { UserMemory, UserProfile } from './dto/memory.dto';

interface ExtractedInfo {
  name?: string;
  location?: string;
  occupation?: string;
  interests?: string[];
  facts?: string[];
  preferences?: Record<string, string>;
}

// AI 추출 Result interface
interface AIExtractedInfo {
  name?: string | null;
  occupation?: string | null;
  location?: string | null;
  interests?: string[];
  facts?: string[];
}

// 명시적 기억 명령 pattern (다국어)
const MEMORY_COMMANDS = [
  // Korean
  /기억해[:\s]*(.+)/i,
  /저장해[:\s]*(.+)/i,
  /메모해[:\s]*(.+)/i,
  /잊지마[:\s]*(.+)/i,
  // English
  /remember[:\s]*(.+)/i,
  /save this[:\s]*(.+)/i,
  /note[:\s]*(.+)/i,
  /don't forget[:\s]*(.+)/i,
  // Japanese
  /覚えて[:\s]*(.+)/i,
  /記憶して[:\s]*(.+)/i,
  /メモして[:\s]*(.+)/i,
  /忘れないで[:\s]*(.+)/i,
  // during국어 (간체)
  /记住[:\s]*(.+)/i,
  /记得[:\s]*(.+)/i,
  /保存[:\s]*(.+)/i,
  /别忘了[:\s]*(.+)/i,
  // during국어 (번체)
  /記住[:\s]*(.+)/i,
  /記得[:\s]*(.+)/i,
  // 베트남어
  /nhớ[:\s]*(.+)/i,
  /ghi nhớ[:\s]*(.+)/i,
  /lưu[:\s]*(.+)/i,
];

// AI 추출 tree거 keyword (다국어)
const AI_TRIGGER_KEYWORDS = [
  // Korean
  /제 name은|저는 .+is|occupation|일하고|살고 있|거주/i,
  /좋아해|관심|취미/i,
  // English
  /my name is|I'm a|I am a|I work as|I live in/i,
  /hobby|interested in|I like/i,
  // Japanese
  /私の名前は|私は.+です|仕事|住んで/i,
  /趣味|興味/i,
  // during국어
  /我叫|我是|我的名字|工作|住在/i,
  /爱好|兴趣|喜欢/i,
  // 베트남어
  /tên tôi là|tôi là|làm việc|sống ở/i,
  /sở thích|thích/i,
];

@Injectable()
export class UserMemoryService {
  private readonly logger = new Logger(UserMemoryService.name);
  private readonly TTL_DAYS: number;
  private readonly ENABLE_AI_EXTRACTION: boolean;

  constructor(
    private redis: RedisService,
    private configService: ConfigService,
  ) {
    this.TTL_DAYS = parseInt(this.configService.get('USER_MEMORY_TTL_DAYS', '30'));
    this.ENABLE_AI_EXTRACTION = this.configService.get('ENABLE_AI_MEMORY_EXTRACTION', 'true') === 'true';
  }

  private getKey(userId: string): string {
    return `user:${userId}:memory`;
  }

  private getTTL(): number {
    return this.TTL_DAYS * 24 * 60 * 60;
  }

  /**
   * Get user memory
   */
  async getMemory(userId: string): Promise<UserMemory | null> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not ready, skipping memory retrieval');
      return null;
    }

    const memory = await this.redis.getJson<UserMemory>(this.getKey(userId));
    if (memory) {
      await this.redis.expire(this.getKey(userId), this.getTTL());
    }
    return memory;
  }

  /**
   * Save user memory
   */
  async saveMemory(userId: string, memory: UserMemory): Promise<void> {
    if (!this.redis.isReady()) return;
    
    memory.profile.updatedAt = new Date().toISOString();
    await this.redis.setJson(this.getKey(userId), memory, this.getTTL());
    this.logger.log(`💾 Saved memory for user ${userId}`);
  }

  /**
   * 프로필 업데이트
   */
  async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<void> {
    const memory = await this.getMemory(userId) || this.createEmptyMemory();
    memory.profile = { ...memory.profile, ...updates, updatedAt: new Date().toISOString() };
    await this.saveMemory(userId, memory);
  }

  /**
   * 사실 추가
   */
  async addFact(userId: string, fact: string, confidence: number, source: string): Promise<void> {
    if (!fact || fact.trim().length < 3) return;
    
    const memory = await this.getMemory(userId) || this.createEmptyMemory();
    
    // during복 체크 (유사도 기반)
    const existingIndex = memory.facts.findIndex(f => 
      this.isSimilarFact(f.fact, fact)
    );

    if (existingIndex >= 0) {
      if (confidence > memory.facts[existingIndex].confidence) {
        memory.facts[existingIndex] = {
          fact: fact.trim(),
          confidence,
          source,
          createdAt: new Date().toISOString(),
        };
      }
    } else {
      memory.facts.push({
        fact: fact.trim(),
        confidence,
        source,
        createdAt: new Date().toISOString(),
      });
      
      // max 30개 유지 (during요도순)
      if (memory.facts.length > 30) {
        memory.facts.sort((a, b) => b.confidence - a.confidence);
        memory.facts = memory.facts.slice(0, 30);
      }
    }

    await this.saveMemory(userId, memory);
    this.logger.log(`📝 Added fact for user ${userId}: ${fact}`);
  }

  /**
   * 유사한 사실인지 확인
   */
  private isSimilarFact(fact1: string, fact2: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
    const n1 = normalize(fact1);
    const n2 = normalize(fact2);
    
    // 포함 관계 체크
    if (n1.includes(n2) || n2.includes(n1)) return true;
    
    // 단어 겹침 체크
    const words1 = new Set(fact1.toLowerCase().split(/\s+/));
    const words2 = new Set(fact2.toLowerCase().split(/\s+/));
    const intersection = [...words1].filter(w => words2.has(w));
    const similarity = intersection.length / Math.max(words1.size, words2.size);
    
    return similarity > 0.6;
  }

  /**
   * 명시적 "기억해" 명령 추출
   */
  private extractExplicitMemory(message: string): string | null {
    for (const pattern of MEMORY_COMMANDS) {
      const match = message.match(pattern);
      if (match && match[1]) {
        const content = match[1].trim();
        // min 길이 체크
        if (content.length >= 3 && content.length <= 200) {
          return content;
        }
      }
    }
    return null;
  }

  /**
   * AI 추출이 필요한지 판단
   */
  private shouldUseAIExtraction(message: string, messageCount: number): boolean {
    if (!this.ENABLE_AI_EXTRACTION) return false;
    
    // 조건 1: 10번째 대화마다
    if (messageCount > 0 && messageCount % 10 === 0) return true;
    
    // 조건 2: 자기소개 keyword 감지
    for (const pattern of AI_TRIGGER_KEYWORDS) {
      if (pattern.test(message)) return true;
    }
    
    return false;
  }

  /**
   * AI를 사용한 info 추출 (Flash 모델 사용 - 비용 최적화)
   */
  async extractWithAI(
    userMessage: string,
    assistantResponse: string,
    aiRouter?: any,
  ): Promise<AIExtractedInfo | null> {
    if (!aiRouter) return null;
    
    try {
      const extractionPrompt = `next from conversation user info를 JSON으로 추출please do.
추출할 info: name(name), occupation(occupation), location(거주지), interests(interests array), facts(during요한 사실 array)
infoif not present null로 설정. 추측do not. 명확히 언급된 것만 추출please do.

대화:
User: ${userMessage.substring(0, 500)}
Assistant: ${assistantResponse.substring(0, 500)}

JSON format으로만 응답please do:`;

      const result = await aiRouter.chatWithCascade(
        [{ role: 'user', content: extractionPrompt }],
        'flash',  // 저비용 모델 사용
      );
      
      // JSON 파싱 시도
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as AIExtractedInfo;
        this.logger.log(`🤖 AI extracted: ${JSON.stringify(parsed)}`);
        return parsed;
      }
    } catch (error) {
      this.logger.warn(`⚠️ AI extraction failed: ${error.message}`);
    }
    
    return null;
  }

  /**
   * from conversation user info 추출 (개선된 버before)
   */
  async extractAndSaveFromConversation(
    userId: string,
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    messageCount?: number,
    aiRouter?: any,
  ): Promise<ExtractedInfo> {
    const extracted: ExtractedInfo = {};
    const source = `session:${sessionId}`;
    
    // 0. 명시적 "기억해" 명령 처리 (최우선)
    const explicitMemory = this.extractExplicitMemory(userMessage);
    if (explicitMemory) {
      await this.addFact(userId, explicitMemory, 1.0, source);
      this.logger.log(`💾 Explicit memory saved: ${explicitMemory}`);
      extracted.facts = [explicitMemory];
      return extracted;
    }
    
    // 1. 향상된 Pattern matching (무료)
    const patternExtracted = this.extractByPatterns(userMessage, assistantResponse);
    
    // 2. semantic 추출 (무료)
    const semanticExtracted = this.extractBySemantic(userMessage, assistantResponse);
    
    // 3. Result 병합
    Object.assign(extracted, patternExtracted, semanticExtracted);
    
    // 4. AI-based extraction (조건부 - 비용 최적화)
    const shouldUseAI = this.shouldUseAIExtraction(userMessage, messageCount || 0);
    const hasEnoughData = extracted.name || extracted.occupation || (extracted.interests && extracted.interests.length > 0);
    
    if (shouldUseAI && !hasEnoughData && aiRouter) {
      this.logger.log(`🤖 Triggering AI extraction (messageCount: ${messageCount})`);
      const aiExtracted = await this.extractWithAI(userMessage, assistantResponse, aiRouter);
      
      if (aiExtracted) {
        // AI Result 병합 (existing pattern Result보다 우선)
        if (aiExtracted.name && !extracted.name) extracted.name = aiExtracted.name;
        if (aiExtracted.occupation && !extracted.occupation) extracted.occupation = aiExtracted.occupation;
        if (aiExtracted.location && !extracted.location) extracted.location = aiExtracted.location;
        if (aiExtracted.interests && aiExtracted.interests.length > 0) {
          extracted.interests = [...new Set([...(extracted.interests || []), ...aiExtracted.interests])];
        }
        if (aiExtracted.facts && aiExtracted.facts.length > 0) {
          extracted.facts = [...new Set([...(extracted.facts || []), ...aiExtracted.facts])];
        }
      }
    }
    
    // name 저장
    if (extracted.name) {
      await this.updateProfile(userId, { name: extracted.name });
      this.logger.log(`👤 Extracted name: ${extracted.name}`);
    }
    
    // occupation 저장
    if (extracted.occupation) {
      await this.updateProfile(userId, { occupation: extracted.occupation });
      this.logger.log(`💼 Extracted occupation: ${extracted.occupation}`);
    }
    
    // location 저장
    if (extracted.location) {
      await this.addFact(userId, `거주지: ${extracted.location}`, 0.85, source);
    }
    
    // interests 저장
    if (extracted.interests && extracted.interests.length > 0) {
      const memory = await this.getMemory(userId) || this.createEmptyMemory();
      const existingInterests = memory.profile.interests || [];
      const newInterests = [...new Set([...existingInterests, ...extracted.interests])].slice(0, 15);
      await this.updateProfile(userId, { interests: newInterests });
      this.logger.log(`🎯 Extracted interests: ${extracted.interests.join(', ')}`);
    }
    
    // 기타 사실 저장
    if (extracted.facts && extracted.facts.length > 0) {
      for (const fact of extracted.facts) {
        await this.addFact(userId, fact, 0.75, source);
      }
    }
    
    // preference도 저장
    if (extracted.preferences) {
      const memory = await this.getMemory(userId) || this.createEmptyMemory();
      memory.preferences = { ...memory.preferences, ...extracted.preferences };
      await this.saveMemory(userId, memory);
    }
    
    return extracted;
  }

  /**
   * pattern 기반 info 추출 (확장)
   */
  private extractByPatterns(userMessage: string, _assistantResponse: string): ExtractedInfo {
    const extracted: ExtractedInfo = {};
    
    // name pattern (확장)
    const namePatterns = [
      /제 name은 ([가-힣]{2,4})/i,
      /저는 ([가-힣]{2,4})(?:이|라고 해|is)/i,
      /my name is ([a-zA-Z]+)/i,
      /I'm ([a-zA-Z]+)/i,
      /call me ([a-zA-Z가-힣]+)/i,
      /([가-힣]{2,4})라고 불러/i,
    ];
    
    for (const pattern of namePatterns) {
      const match = userMessage.match(pattern);
      if (match && match[1]) {
        extracted.name = match[1].trim();
        break;
      }
    }
    
    // occupation pattern (확장)
    const occupationPatterns = [
      /(?:저는|나는|제가) ([가-힣a-zA-Z]+)(?:이에요|is|예요|야|로 일해)/i,
      /occupation은? ([가-힣a-zA-Z\s]+)/i,
      /I(?:'m| am) (?:a |an )?([a-zA-Z\s]+?)(?:\.|,|$)/i,
      /work(?:ing)? as (?:a |an )?([a-zA-Z\s]+)/i,
      /([가-힣]+) 일을 하고/i,
    ];
    
    const occupationKeywords = ['개발자', '디자이너', '기획자', '마케터', '엔지니어', '학생', '교사', '의사', '변호사', 
      'developer', 'designer', 'engineer', 'student', 'teacher', 'manager', 'analyst'];
    
    for (const pattern of occupationPatterns) {
      const match = userMessage.match(pattern);
      if (match && match[1]) {
        const occupation = match[1].trim();
        // occupation keyword가 포함되어 있는지 확인
        if (occupationKeywords.some(k => occupation.toLowerCase().includes(k.toLowerCase()))) {
          extracted.occupation = occupation;
          break;
        }
      }
    }
    
    // location pattern (확장)
    const locationPatterns = [
      /([가-힣]+)에 살(?:아요|고 있어|아)/i,
      /([가-힣]+) 거주/i,
      /live in ([a-zA-Z가-힣\s]+)/i,
      /from ([a-zA-Z가-힣\s]+)/i,
      /([가-힣]+)에서 왔/i,
      /current ([가-힣]+)에/i,
    ];
    
    for (const pattern of locationPatterns) {
      const match = userMessage.match(pattern);
      if (match && match[1]) {
        extracted.location = match[1].trim();
        break;
      }
    }
    
    // preference도 pattern
    const preferencePatterns = [
      { regex: /([가-힣a-zA-Z]+)(?:을|를)? (?:좋아해|preference해|즐겨)/i, type: 'likes' },
      { regex: /(?:좋아하는|preference하는) ([가-힣a-zA-Z]+)/i, type: 'likes' },
      { regex: /([가-힣a-zA-Z]+)(?:은|는)? (?:싫어|별로)/i, type: 'dislikes' },
      { regex: /I (?:like|love|prefer) ([a-zA-Z\s]+)/i, type: 'likes' },
      { regex: /I (?:don't like|hate|dislike) ([a-zA-Z\s]+)/i, type: 'dislikes' },
    ];
    
    extracted.preferences = {};
    for (const { regex, type } of preferencePatterns) {
      const match = userMessage.match(regex);
      if (match && match[1]) {
        extracted.preferences[type] = match[1].trim();
      }
    }
    
    return extracted;
  }

  /**
   * semantic info 추출
   */
  private extractBySemantic(userMessage: string, assistantResponse: string): ExtractedInfo {
    const extracted: ExtractedInfo = { interests: [], facts: [] };
    
    // 기술/도구 interests (확장)
    const techKeywords = [
      // 프로그래밍 언어
      'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Swift', 'Kotlin',
      'PHP', 'Ruby', 'Scala', 'R', 'MATLAB', 'SQL',
      // 프레임워크/라이브러리
      'React', 'Vue', 'Angular', 'Next.js', 'Nuxt', 'Svelte', 'Node.js', 'Express', 'NestJS',
      'Django', 'Flask', 'FastAPI', 'Spring', 'Laravel', 'Rails',
      // 기술 분야
      'AI', '머신러닝', '딥러닝', 'ML', 'Deep Learning', 'NLP', 'Computer Vision',
      '웹개발', '앱개발', '백엔드', '프론트엔드', 'DevOps', '클라우드', 'AWS', 'GCP', 'Azure',
      'data분석', 'data사이언스', 'Data Science', 'Big Data',
      // 도구
      'Docker', 'Kubernetes', 'Git', 'Linux', 'Figma', 'Photoshop',
    ];
    
    // 취미/interests keyword
    const hobbyKeywords = [
      '게임', '영화', '음악', '독서', '여행', '운동', '요리', '사진', '그림', '글쓰기',
      '등산', '수영', '자before거', '러닝', '요가', '헬스',
      'gaming', 'movies', 'music', 'reading', 'travel', 'cooking', 'photography',
    ];
    
    const allKeywords = [...techKeywords, ...hobbyKeywords];
    const lowerMessage = userMessage.toLowerCase();
    
    for (const keyword of allKeywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        extracted.interests!.push(keyword);
      }
    }
    
    // during요한 사실 추출 (문장 pattern)
    const factPatterns = [
      /(?:저는|나는|제가) (.{5,50})(?:해요|does|예요|야)/g,
      /(?:요즘|최근에) (.{5,40})(?:하고 있어|during이에요)/g,
      /(.{5,40})(?:에 관심이 있어|을 배우고 있어)/g,
    ];
    
    for (const pattern of factPatterns) {
      const matches = userMessage.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 5 && match[1].length < 50) {
          // 너무 일반적인 문장 제외
          const genericPhrases = ['뭐', '어떻게', '왜', '언제', '어디'];
          if (!genericPhrases.some(p => match[1].startsWith(p))) {
            extracted.facts!.push(match[1].trim());
          }
        }
      }
    }
    
    // during복 제거
    extracted.interests = [...new Set(extracted.interests)];
    extracted.facts = [...new Set(extracted.facts)].slice(0, 3);
    
    return extracted;
  }

  /**
   * delete memory (GDPR)
   */
  async deleteMemory(userId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    await this.redis.del(this.getKey(userId));
    this.logger.log(`🗑️ Deleted memory for user ${userId}`);
  }

  /**
   * Generate memory summary (prompt용) - 개선된 버before
   */
  async getMemorySummary(userId: string): Promise<string | null> {
    const memory = await this.getMemory(userId);
    if (!memory) return null;

    const parts: string[] = [];

    // 프로필 info
    if (memory.profile.name) {
      parts.push(`사용자 name: ${memory.profile.name}`);
    }
    if (memory.profile.occupation) {
      parts.push(`occupation: ${memory.profile.occupation}`);
    }
    if (memory.profile.interests && memory.profile.interests.length > 0) {
      parts.push(`관심 분야: ${memory.profile.interests.slice(0, 8).join(', ')}`);
    }
    
    // preference도
    if (memory.preferences) {
      if (memory.preferences.likes) {
        parts.push(`preference: ${memory.preferences.likes}`);
      }
      if (memory.preferences.language) {
        parts.push(`preference 언어: ${memory.preferences.language}`);
      }
    }
    
    // during요 사실 (confidence high 것만)
    if (memory.facts.length > 0) {
      const topFacts = memory.facts
        .filter(f => f.confidence >= 0.7)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
        .map(f => f.fact);
      if (topFacts.length > 0) {
        parts.push(`알려진 info: ${topFacts.join('; ')}`);
      }
    }

    if (parts.length === 0) return null;
    
    return `[user memory]\n${parts.join('\n')}`;
  }

  private createEmptyMemory(): UserMemory {
    return {
      profile: {
        updatedAt: new Date().toISOString(),
      },
      facts: [],
      preferences: {},
    };
  }
}
