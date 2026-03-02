import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

// Entity type definition
export enum EntityType {
  PERSON = 'PERSON',       // 사람 name
  TECH = 'TECH',           // 기술/프레임워크
  PLACE = 'PLACE',         // 장소/location
  ORGANIZATION = 'ORG',    // 회사/조직
  CONCEPT = 'CONCEPT',     // 개념/주제
  PRODUCT = 'PRODUCT',     // 제품/service
  EVENT = 'EVENT',         // event/일정
}

// Entity data structure
export interface Entity {
  name: string;
  type: EntityType;
  frequency: number;       // 언급 빈도
  lastMentioned: string;   // last 언급 time
  firstMentioned: string;  // 첫 언급 time
  contexts: string[];      // 언급된 맥락 (최근 5개)
  confidence: number;      // 추출 신뢰도 (0-1)
}

// Entity Store all structure
export interface EntityStore {
  entities: Record<string, Entity>;  // key: normalized entity name
  totalMentions: number;
  lastUpdated: string;
}

// 추출된 Entity Result
export interface ExtractedEntity {
  name: string;
  type: EntityType;
  confidence: number;
  context?: string;
}

// 기술 keyword list (Rule-based extraction용)
const TECH_KEYWORDS = [
  // 프로그래밍 언어
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Swift', 'Kotlin',
  'PHP', 'Ruby', 'Scala', 'R', 'MATLAB', 'SQL', 'HTML', 'CSS', 'Dart', 'Lua',
  // 프레임워크/라이브러리
  'React', 'Vue', 'Angular', 'Next.js', 'Nuxt', 'Svelte', 'Node.js', 'Express', 'NestJS',
  'Django', 'Flask', 'FastAPI', 'Spring', 'Laravel', 'Rails', 'Flutter', 'React Native',
  'TensorFlow', 'PyTorch', 'Keras', 'scikit-learn', 'pandas', 'numpy',
  // 도구/플랫폼
  'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'Git', 'GitHub', 'GitLab',
  'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'Elasticsearch', 'GraphQL', 'REST',
  'Linux', 'Ubuntu', 'macOS', 'Windows', 'Figma', 'Photoshop', 'VSCode',
  // AI/ML
  'GPT', 'ChatGPT', 'Claude', 'Gemini', 'LLM', 'RAG', 'Transformer', 'BERT',
  'OpenAI', 'Anthropic', 'Hugging Face', 'LangChain', 'Vector DB',
];

// Korean 기술 keyword
const TECH_KEYWORDS_KO = [
  '리액트', '뷰', '앵귤러', 'node', '파이썬', '자바', 'type스크립트', '자바스크립트',
  '머신러닝', '딥러닝', '인공지능', '웹개발', '앱개발', '백엔드', '프론트엔드',
  'data베이스', '클라우드', '도커', '쿠버네티스', '깃', '깃허브',
];

// 장소 keyword
const PLACE_KEYWORDS = [
  '서울', '부산', '인천', '대구', '대before', '광주', '울산', '세종', '제주',
  '경기', '강원', '충북', '충남', 'before북', 'before남', '경북', '경남',
  'Seoul', 'Busan', 'Tokyo', 'New York', 'San Francisco', 'London', 'Paris',
  'Singapore', 'Hong Kong', 'Shanghai', 'Beijing', 'Sydney', 'Berlin',
];

// occupation keyword
const OCCUPATION_KEYWORDS = [
  '개발자', '디자이너', '기획자', '마케터', '엔지니어', '학생', '교사', '교수',
  '의사', '변호사', '회계사', '컨설턴트', '매니저', '대표', 'CEO', 'CTO',
  'developer', 'designer', 'engineer', 'student', 'teacher', 'manager',
  'analyst', 'consultant', 'architect', 'scientist', 'researcher',
];

@Injectable()
export class EntityStoreService {
  private readonly logger = new Logger(EntityStoreService.name);
  private readonly TTL_DAYS: number;
  private readonly MAX_CONTEXTS: number = 5;
  private readonly MAX_ENTITIES: number = 100;

  constructor(
    private redis: RedisService,
    private configService: ConfigService,
  ) {
    this.TTL_DAYS = parseInt(this.configService.get('ENTITY_STORE_TTL_DAYS', '60'));
  }

  private getKey(userId: string): string {
    return `user:${userId}:entities`;
  }

  private getTTL(): number {
    return this.TTL_DAYS * 24 * 60 * 60;
  }

  /**
   * Entity Store 조회
   */
  async getStore(userId: string): Promise<EntityStore | null> {
    if (!this.redis.isReady()) return null;
    
    const store = await this.redis.getJson<EntityStore>(this.getKey(userId));
    if (store) {
      await this.redis.expire(this.getKey(userId), this.getTTL());
    }
    return store;
  }

  /**
   * Entity Store 저장
   */
  async saveStore(userId: string, store: EntityStore): Promise<void> {
    if (!this.redis.isReady()) return;
    
    store.lastUpdated = new Date().toISOString();
    await this.redis.setJson(this.getKey(userId), store, this.getTTL());
  }

  /**
   * rule-based Entity 추출 (AI 호출 없음 - 무료)
   */
  extractByRules(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const lowerText = text.toLowerCase();
    const normalizedText = text;

    // 1. 기술 Keyword extraction
    for (const tech of [...TECH_KEYWORDS, ...TECH_KEYWORDS_KO]) {
      if (lowerText.includes(tech.toLowerCase())) {
        entities.push({
          name: tech,
          type: EntityType.TECH,
          confidence: 0.9,
        });
      }
    }

    // 2. 장소 추출
    for (const place of PLACE_KEYWORDS) {
      if (normalizedText.includes(place)) {
        entities.push({
          name: place,
          type: EntityType.PLACE,
          confidence: 0.85,
        });
      }
    }

    // 3. 장소 Pattern matching
    const placePatterns = [
      /([가-힣]{2,4})에 (?:살|거주|일해|있어)/g,
      /([가-힣]{2,4})에서 (?:왔|일하|살)/g,
      /live in ([A-Za-z\s]+)/gi,
      /from ([A-Za-z\s]+)/gi,
    ];
    
    for (const pattern of placePatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length >= 2) {
          entities.push({
            name: match[1].trim(),
            type: EntityType.PLACE,
            confidence: 0.8,
          });
        }
      }
    }

    // 4. occupation 추출
    for (const occupation of OCCUPATION_KEYWORDS) {
      if (lowerText.includes(occupation.toLowerCase())) {
        entities.push({
          name: occupation,
          type: EntityType.CONCEPT,
          confidence: 0.85,
        });
      }
    }

    // 5. name pattern 추출
    const namePatterns = [
      /제 name은 ([가-힣]{2,4})/,
      /저는 ([가-힣]{2,4})(?:이|라고|is)/,
      /my name is ([A-Za-z]+)/i,
      /I'm ([A-Za-z]+)/i,
      /call me ([A-Za-z가-힣]+)/i,
    ];
    
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        entities.push({
          name: match[1].trim(),
          type: EntityType.PERSON,
          confidence: 0.95,
        });
      }
    }

    // 6. 회사/조직 pattern
    const orgPatterns = [
      /([가-힣A-Za-z]+)(?:에서|회사|팀)/g,
      /work(?:ing)? (?:at|for) ([A-Za-z\s]+)/gi,
    ];
    
    for (const pattern of orgPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length >= 2 && match[1].length <= 20) {
          // 일반적인 단어 제외
          const commonWords = ['저', '나', '우리', '그', 'the', 'a', 'an'];
          if (!commonWords.includes(match[1].toLowerCase())) {
            entities.push({
              name: match[1].trim(),
              type: EntityType.ORGANIZATION,
              confidence: 0.7,
            });
          }
        }
      }
    }

    // during복 제거 (name 기준)
    const uniqueEntities = new Map<string, ExtractedEntity>();
    for (const entity of entities) {
      const key = entity.name.toLowerCase();
      if (!uniqueEntities.has(key) || uniqueEntities.get(key)!.confidence < entity.confidence) {
        uniqueEntities.set(key, entity);
      }
    }

    return Array.from(uniqueEntities.values());
  }

  /**
   * AI 기반 Entity 추출 (local model 우선)
   */
  async extractWithAI(
    text: string,
    aiRouter?: any,
    useLocalModel: boolean = true,
  ): Promise<ExtractedEntity[]> {
    if (!aiRouter) return [];

    const extractionPrompt = `next 텍스트에서 during요한 Entity(개체)를 추출please do.
추출할 Entity type: PERSON(사람), TECH(기술), PLACE(장소), ORG(조직), CONCEPT(개념), PRODUCT(제품), EVENT(event)

텍스트: "${text.substring(0, 500)}"

JSON array로만 응답please do. 예시:
[{"name": "React", "type": "TECH"}, {"name": "서울", "type": "PLACE"}]

during요하지 않은 일반 단어는 제외please do. max 5개만 추출please do.`;

    try {
      // local model 우선 사용 (Ollama)
      const modelToUse = useLocalModel ? 'lite' : 'flash';
      
      const result = await aiRouter.chatWithCascade(
        [{ role: 'user', content: extractionPrompt }],
        modelToUse,
      );

      // JSON 파싱
      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{ name: string; type: string }>;
        return parsed.map(e => ({
          name: e.name,
          type: (EntityType[e.type as keyof typeof EntityType] || EntityType.CONCEPT),
          confidence: 0.75,
        }));
      }
    } catch (error) {
      this.logger.warn(`AI entity extraction failed: ${error.message}`);
    }

    return [];
  }

  /**
   * 스마트 Entity 추출 (rule-based + conditional AI)
   */
  async smartExtract(
    userId: string,
    userMessage: string,
    assistantResponse: string,
    messageCount: number,
    aiRouter?: any,
    isLocalModelAvailable: boolean = false,
  ): Promise<ExtractedEntity[]> {
    const combinedText = `${userMessage} ${assistantResponse}`;
    
    // 1. 항상 rule-based 먼저 (무료)
    const ruleBasedEntities = this.extractByRules(combinedText);
    this.logger.log(`📋 Rule-based extraction: ${ruleBasedEntities.length} entities`);

    // 2. AI 추출 조건 판단
    const shouldUseAI = this.shouldUseAIExtraction(
      userMessage,
      messageCount,
      ruleBasedEntities.length,
    );

    if (shouldUseAI && aiRouter) {
      this.logger.log(`🤖 Triggering AI extraction (local: ${isLocalModelAvailable})`);
      
      const aiEntities = await this.extractWithAI(
        combinedText,
        aiRouter,
        isLocalModelAvailable,  // local model 우선
      );

      // rule-based + AI Result 병합 (during복 제거)
      const merged = this.mergeEntities(ruleBasedEntities, aiEntities);
      return merged;
    }

    return ruleBasedEntities;
  }

  /**
   * AI 추출 필요 whether 판단
   */
  private shouldUseAIExtraction(
    message: string,
    messageCount: number,
    ruleBasedCount: number,
  ): boolean {
    // 조건 1: 20번째 대화마다 (비용 최적화)
    if (messageCount > 0 && messageCount % 20 === 0) return true;

    // 조건 2: 명시적 기억 요청
    const memoryCommands = /기억해|저장해|remember|save this|메모해/i;
    if (memoryCommands.test(message)) return true;

    // 조건 3: 자기소개 keyword
    const introKeywords = /제 name은|저는 .+is|my name is|I'm a|I work/i;
    if (introKeywords.test(message)) return true;

    // 조건 4: rule-based으로 아무것도 못 찾았고, 메시지가 충분히 길 when
    if (ruleBasedCount === 0 && message.length > 50) return true;

    // 조건 5: complex 문장 (여러 주제 언급)
    const sentenceCount = message.split(/[.!?。！？]/).filter(s => s.trim()).length;
    if (sentenceCount >= 3 && ruleBasedCount < 2) return true;

    return false;
  }

  /**
   * Entity 병합 (during복 제거)
   */
  private mergeEntities(
    ruleBasedEntities: ExtractedEntity[],
    aiEntities: ExtractedEntity[],
  ): ExtractedEntity[] {
    const merged = new Map<string, ExtractedEntity>();

    // rule-based 먼저 추가
    for (const entity of ruleBasedEntities) {
      merged.set(entity.name.toLowerCase(), entity);
    }

    // AI Result 추가 (during복 시 confidence high 것 유지)
    for (const entity of aiEntities) {
      const key = entity.name.toLowerCase();
      const existing = merged.get(key);
      
      if (!existing || existing.confidence < entity.confidence) {
        merged.set(key, entity);
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Entity Store 업데이트
   */
  async updateStore(
    userId: string,
    entities: ExtractedEntity[],
    context: string,
  ): Promise<void> {
    if (entities.length === 0) return;

    let store = await this.getStore(userId) || this.createEmptyStore();
    const now = new Date().toISOString();

    for (const extracted of entities) {
      const key = extracted.name.toLowerCase();
      
      if (store.entities[key]) {
        // existing Entity 업데이트
        const entity = store.entities[key];
        entity.frequency += 1;
        entity.lastMentioned = now;
        entity.confidence = Math.max(entity.confidence, extracted.confidence);
        
        // Context 추가 (최근 5개 유지)
        if (context && context.length > 10) {
          entity.contexts.push(context.substring(0, 100));
          if (entity.contexts.length > this.MAX_CONTEXTS) {
            entity.contexts = entity.contexts.slice(-this.MAX_CONTEXTS);
          }
        }
      } else {
        // new Entity 추가
        store.entities[key] = {
          name: extracted.name,
          type: extracted.type,
          frequency: 1,
          lastMentioned: now,
          firstMentioned: now,
          contexts: context ? [context.substring(0, 100)] : [],
          confidence: extracted.confidence,
        };
      }
      
      store.totalMentions += 1;
    }

    // Entity 수 제한 (old 것 제거)
    const entityKeys = Object.keys(store.entities);
    if (entityKeys.length > this.MAX_ENTITIES) {
      const sorted = entityKeys.sort((a, b) => {
        const entityA = store.entities[a];
        const entityB = store.entities[b];
        // 빈도 * 최근성 점수로 정렬
        const scoreA = entityA.frequency * (1 / (Date.now() - new Date(entityA.lastMentioned).getTime()));
        const scoreB = entityB.frequency * (1 / (Date.now() - new Date(entityB.lastMentioned).getTime()));
        return scoreB - scoreA;
      });
      
      const toKeep = sorted.slice(0, this.MAX_ENTITIES);
      const newEntities: Record<string, Entity> = {};
      for (const key of toKeep) {
        newEntities[key] = store.entities[key];
      }
      store.entities = newEntities;
    }

    await this.saveStore(userId, store);
    this.logger.log(`💾 Updated entity store for user ${userId}: ${entities.length} entities`);
  }

  /**
   * 자주 언급되는 Entity 조회 (interests 파악용)
   */
  async getTopEntities(
    userId: string,
    limit: number = 10,
    type?: EntityType,
  ): Promise<Entity[]> {
    const store = await this.getStore(userId);
    if (!store) return [];

    let entities = Object.values(store.entities);
    
    // type filter링
    if (type) {
      entities = entities.filter(e => e.type === type);
    }

    // 빈도순 정렬
    entities.sort((a, b) => b.frequency - a.frequency);

    return entities.slice(0, limit);
  }

  /**
   * Entity 기반 user profile Generate summary
   */
  async getEntitySummary(userId: string): Promise<string | null> {
    const store = await this.getStore(userId);
    if (!store || Object.keys(store.entities).length === 0) return null;

    const parts: string[] = [];

    // 기술 interests
    const techEntities = Object.values(store.entities)
      .filter(e => e.type === EntityType.TECH && e.frequency >= 2)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);
    
    if (techEntities.length > 0) {
      parts.push(`관심 기술: ${techEntities.map(e => e.name).join(', ')}`);
    }

    // 자주 언급하는 장소
    const placeEntities = Object.values(store.entities)
      .filter(e => e.type === EntityType.PLACE && e.frequency >= 1)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 3);
    
    if (placeEntities.length > 0) {
      parts.push(`관련 장소: ${placeEntities.map(e => e.name).join(', ')}`);
    }

    // 자주 언급하는 개념
    const conceptEntities = Object.values(store.entities)
      .filter(e => e.type === EntityType.CONCEPT && e.frequency >= 2)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);
    
    if (conceptEntities.length > 0) {
      parts.push(`관심 분야: ${conceptEntities.map(e => e.name).join(', ')}`);
    }

    if (parts.length === 0) return null;

    return `[Entity 기반 프로필]\n${parts.join('\n')}`;
  }

  /**
   * Entity Store 삭제 (GDPR)
   */
  async deleteStore(userId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    await this.redis.del(this.getKey(userId));
    this.logger.log(`🗑️ Deleted entity store for user ${userId}`);
  }

  private createEmptyStore(): EntityStore {
    return {
      entities: {},
      totalMentions: 0,
      lastUpdated: new Date().toISOString(),
    };
  }
}
