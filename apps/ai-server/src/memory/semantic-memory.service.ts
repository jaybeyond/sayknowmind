import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import axios from 'axios';

interface MemoryEntry {
  id: string;
  content: string;
  type: 'fact' | 'conversation' | 'preference' | 'keypoint';
  embedding?: number[];
  timestamp: string;
  sessionId?: string;
  confidence: number;
}

interface SearchResult {
  content: string;
  type: string;
  similarity: number;
  timestamp: string;
}

@Injectable()
export class SemanticMemoryService {
  private readonly logger = new Logger(SemanticMemoryService.name);
  private readonly MEMORY_KEY_PREFIX = 'semantic:';
  private readonly INDEX_KEY = 'semantic:index:';
  private readonly TTL_DAYS: number;
  private readonly openrouterApiKey: string;
  private readonly enabled: boolean;

  constructor(
    private redis: RedisService,
    private configService: ConfigService,
  ) {
    this.TTL_DAYS = parseInt(this.configService.get('SEMANTIC_MEMORY_TTL_DAYS', '90'));
    this.openrouterApiKey = this.configService.get('OPENROUTER_API_KEY', '');
    this.enabled = this.configService.get('ENABLE_SEMANTIC_MEMORY', 'true') === 'true';
  }

  private getMemoryKey(userId: string): string {
    return `${this.MEMORY_KEY_PREFIX}${userId}`;
  }

  private getIndexKey(userId: string): string {
    return `${this.INDEX_KEY}${userId}`;
  }

  private getTTL(): number {
    return this.TTL_DAYS * 24 * 60 * 60;
  }

  /**
   * 텍스트를 Embedding으로 변환 (OpenRouter free model 사용)
   */
  private async getEmbedding(text: string): Promise<number[] | null> {
    if (!this.openrouterApiKey) return null;

    try {
      // simple hash 기반 pseudo-embedding (무료, 빠름)
      // 실제 production에서는 OpenAI/Cohere embedding API 사용 권장
      return this.generateSimpleEmbedding(text);
    } catch (error) {
      this.logger.warn(`Embedding generation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * simple hash 기반 Embedding 생성 (무료 대inside)
   * TF-IDF 스타일의 단어 빈도 기반 벡터
   */
  private generateSimpleEmbedding(text: string): number[] {
    const VECTOR_SIZE = 128;
    const vector = new Array(VECTOR_SIZE).fill(0);
    
    // 텍스트 정규화
    const normalized = text.toLowerCase()
      .replace(/[^\w\s가-힣]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);
    
    // 단어별 hash를 벡터에 분산
    for (const word of normalized) {
      const hash = this.hashString(word);
      const index = Math.abs(hash) % VECTOR_SIZE;
      vector[index] += 1;
      
      // bi-gram도 추가
      if (word.length > 2) {
        for (let i = 0; i < word.length - 1; i++) {
          const bigram = word.substring(i, i + 2);
          const bigramHash = this.hashString(bigram);
          const bigramIndex = Math.abs(bigramHash) % VECTOR_SIZE;
          vector[bigramIndex] += 0.5;
        }
      }
    }
    
    // L2 정규화
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }
    
    return vector;
  }

  /**
   * string hash 함수
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * 코사인 유사도 계산
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  /**
   * 메모리 저장 (Embedding 포함)
   */
  async saveMemory(
    userId: string,
    content: string,
    type: MemoryEntry['type'],
    sessionId?: string,
    confidence: number = 0.8,
  ): Promise<void> {
    if (!this.enabled || !this.redis.isReady()) return;
    if (!content || content.length < 5) return;

    const embedding = await this.getEmbedding(content);
    if (!embedding) return;

    const entry: MemoryEntry = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content: content.substring(0, 500),  // max 500자
      type,
      embedding,
      timestamp: new Date().toISOString(),
      sessionId,
      confidence,
    };

    // 메모리 list에 추가
    const key = this.getMemoryKey(userId);
    await this.redis.rpush(key, JSON.stringify(entry));
    await this.redis.expire(key, this.getTTL());

    // max 200개 유지
    const length = await this.redis.llen(key);
    if (length > 200) {
      await this.redis.ltrim(key, -200, -1);
    }

    this.logger.debug(`💾 Saved semantic memory: ${type} - ${content.substring(0, 50)}...`);
  }

  /**
   * semantic 검색 (유사한 메모리 찾기)
   */
  async searchMemory(
    userId: string,
    query: string,
    topK: number = 5,
    minSimilarity: number = 0.3,
  ): Promise<SearchResult[]> {
    if (!this.enabled || !this.redis.isReady()) return [];

    const queryEmbedding = await this.getEmbedding(query);
    if (!queryEmbedding) return [];

    const key = this.getMemoryKey(userId);
    const memories = await this.redis.lrange(key, 0, -1);
    
    if (memories.length === 0) return [];

    // 모든 메모리와 유사도 계산
    const results: Array<MemoryEntry & { similarity: number }> = [];
    
    for (const memStr of memories) {
      try {
        const mem = JSON.parse(memStr) as MemoryEntry;
        if (!mem.embedding) continue;
        
        const similarity = this.cosineSimilarity(queryEmbedding, mem.embedding);
        if (similarity >= minSimilarity) {
          results.push({ ...mem, similarity });
        }
      } catch {
        continue;
      }
    }

    // 유사도 순 정렬 after 상above K개 반환
    results.sort((a, b) => b.similarity - a.similarity);
    
    return results.slice(0, topK).map(r => ({
      content: r.content,
      type: r.type,
      similarity: r.similarity,
      timestamp: r.timestamp,
    }));
  }

  /**
   * from conversation important information auto-save
   */
  async extractAndSaveFromConversation(
    userId: string,
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    if (!this.enabled) return;

    // 사용자 메시지에서 Extract important information
    const importantPatterns = [
      // 자기소개
      { pattern: /(?:제 name은|저는|I'm|my name is) .{2,30}/i, type: 'fact' as const },
      // preference도
      { pattern: /(?:좋아|싫어|prefer|like|hate) .{2,50}/i, type: 'preference' as const },
      // 요청/목표
      { pattern: /(?:하고 싶|want to|need to|해줘|도와줘) .{5,100}/i, type: 'keypoint' as const },
      // important information
      { pattern: /(?:during요|important|기억해|remember) .{5,100}/i, type: 'fact' as const },
    ];

    for (const { pattern, type } of importantPatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        await this.saveMemory(userId, match[0], type, sessionId, 0.85);
      }
    }

    // 긴 대화는 요약해서 저장
    if (userMessage.length > 100) {
      await this.saveMemory(
        userId,
        `User: ${userMessage.substring(0, 200)}`,
        'conversation',
        sessionId,
        0.7,
      );
    }
  }

  /**
   * 관련 메모리를 Context로 변환
   */
  async getRelevantContext(userId: string, query: string): Promise<string | null> {
    const results = await this.searchMemory(userId, query, 5, 0.35);
    
    if (results.length === 0) return null;

    const contextParts = results.map(r => {
      const typeLabel = {
        fact: '사실',
        preference: 'preference',
        conversation: '대화',
        keypoint: '핵심',
      }[r.type] || r.type;
      
      return `- [${typeLabel}] ${r.content}`;
    });

    return `[관련 기억]\n${contextParts.join('\n')}`;
  }

  /**
   * Delete user memory
   */
  async deleteMemory(userId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    await this.redis.del(this.getMemoryKey(userId));
    this.logger.log(`🗑️ Deleted semantic memory for user ${userId}`);
  }
}
