import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '../memory/redis.service';
import {
  Span,
  SpanType,
  SpanStatus,
  CreateSpanDto,
  UpdateSpanDto,
  SpanFilter,
} from './dto/span.dto';

/**
 * Span Service
 * 
 * Span data의 CRUD 및 조회를 담당does.
 * Redis에 TTL 7일로 saves.
 * 민감 info filter링을 통해 API key, 이메일, before화번호 등을 removes.
 * 
 * Requirements: 2.2, 2.3, 2.4, 2.5, 8.1, 8.2, 8.5
 */
@Injectable()
export class SpanService {
  private readonly logger = new Logger(SpanService.name);
  
  // TTL 상수 (초 단above)
  static readonly SPAN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7일 = 604800초
  
  // Redis key 프리픽스
  private readonly KEY_PREFIX = 'span:';
  private readonly USER_LIST_PREFIX = 'span:user:';
  private readonly SESSION_LIST_PREFIX = 'span:session:';

  // 민감 info pattern (Requirements 8.5)
  private readonly SENSITIVE_PATTERNS = {
    // API key pattern: sk-, pk-, api_key, apikey, api-key, secret, token 뒤에 영숫자
    apiKey: /\b(sk-|pk-|api[_-]?key|secret|token)[a-zA-Z0-9_-]{8,}\b/gi,
    // 이메일 pattern (더 엄격한 pattern: 알파벳/숫자로 start해야 함)
    email: /\b[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b/gi,
    // before화번호 pattern (한국 및 국제 format)
    phone: /\b(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g,
    // 신용카드 번호 pattern (16자리)
    creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    // 비밀번호 pattern
    password: /\b(password|pwd|passwd)\s*[=:]\s*\S+/gi,
  };

  // 민감 info 대체 string
  private readonly REDACTED = '[REDACTED]';

  constructor(private readonly redis: RedisService) {}

  /**
   * Create Span
   * 
   * @param dto Create Span data
   * @returns 생성된 Span
   */
  async create(dto: CreateSpanDto): Promise<Span> {
    return this.createWithId(uuidv4(), dto);
  }

  /**
   * 지정된 ID로 Create Span
   * 
   * TracerService에서 미리 생성한 ID를 사용하여 Span saves.
   * 이렇게 하면 TracerService와 SpanService 간 ID 불일치 문제를 방지does.
   * 
   * @param spanId 사용할 Span ID
   * @param dto Create Span data
   * @returns 생성된 Span
   */
  async createWithId(spanId: string, dto: CreateSpanDto): Promise<Span> {
    // 민감 info filter링 적용 (Requirements 8.5)
    const sanitizedMetadata = this.sanitizeMetadata(dto.metadata || {});
    
    const span: Span = {
      id: spanId,
      type: dto.type,
      status: SpanStatus.STARTED,
      userId: dto.userId,
      sessionId: dto.sessionId,
      parentSpanId: dto.parentSpanId,
      startTime: new Date().toISOString(),
      modelRequested: dto.modelRequested,
      metadata: sanitizedMetadata,
    };

    await this.save(span);
    
    // per user, per session 인덱스에 추가
    if (span.userId) {
      await this.addToUserIndex(span.userId, span.id);
    }
    if (span.sessionId) {
      await this.addToSessionIndex(span.sessionId, span.id);
    }

    this.logger.debug(`Span created: ${span.id} (type: ${span.type})`);
    return span;
  }

  /**
   * Update Span
   * 
   * @param spanId Span ID
   * @param updates 업데이트할 필드
   * @returns 업데이트된 Span 또는 null
   */
  async update(spanId: string, updates: UpdateSpanDto): Promise<Span | null> {
    const span = await this.findById(spanId);
    if (!span) {
      this.logger.warn(`Span not found for update: ${spanId}`);
      return null;
    }

    // 민감 info filter링 적용 (Requirements 8.5)
    const sanitizedUpdates = { ...updates };
    if ((updates as any).metadata) {
      (sanitizedUpdates as any).metadata = this.sanitizeMetadata((updates as any).metadata);
    }

    // 업데이트 적용
    const updatedSpan: Span = {
      ...span,
      ...sanitizedUpdates,
      metadata: this.sanitizeMetadata({
        ...span.metadata,
        ...(sanitizedUpdates as any).metadata,
      }),
    };

    await this.save(updatedSpan);
    this.logger.debug(`Span updated: ${spanId}`);
    return updatedSpan;
  }

  /**
   * ID로 Get Span
   * 
   * @param spanId Span ID
   * @returns Span 또는 null
   */
  async findById(spanId: string): Promise<Span | null> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available for findById');
      return null;
    }

    const key = this.getSpanKey(spanId);
    return this.redis.getJson<Span>(key);
  }

  /**
   * filter conditions으로 List Spans
   * 
   * @param filter filter conditions
   * @returns Span list
   */
  async findMany(filter: SpanFilter): Promise<Span[]> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available for findMany');
      return [];
    }

    let spanIds: string[] = [];

    // userId로 filter링
    if (filter.userId) {
      spanIds = await this.getSpanIdsByUser(filter.userId);
    }
    // sessionId로 filter링
    else if (filter.sessionId) {
      spanIds = await this.getSpanIdsBySession(filter.sessionId);
    }
    // filter 없으면 빈 array 반환 (all 스캔 방지)
    else {
      this.logger.warn('findMany called without userId or sessionId filter');
      return [];
    }

    // Span data 조회
    const spans: Span[] = [];
    for (const spanId of spanIds) {
      const span = await this.findById(spanId);
      if (span && this.matchesFilter(span, filter)) {
        spans.push(span);
      }
    }

    // time순 정렬 (latest 먼저)
    spans.sort((a, b) => 
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

    // limit 적용
    if (filter.limit && filter.limit > 0) {
      return spans.slice(0, filter.limit);
    }

    return spans;
  }

  /**
   * child Get Span (parent-child 관계)
   * 
   * @param parentSpanId parent Span ID
   * @returns child Span list
   */
  async findChildren(parentSpanId: string): Promise<Span[]> {
    const parentSpan = await this.findById(parentSpanId);
    if (!parentSpan) {
      return [];
    }

    // parent Span's userId 또는 sessionId로 검색
    const filter: SpanFilter = {};
    if (parentSpan.userId) {
      filter.userId = parentSpan.userId;
    } else if (parentSpan.sessionId) {
      filter.sessionId = parentSpan.sessionId;
    } else {
      return [];
    }

    const allSpans = await this.findMany(filter);
    return allSpans.filter(span => span.parentSpanId === parentSpanId);
  }

  /**
   * Delete Span
   * 
   * @param spanId Span ID
   */
  async delete(spanId: string): Promise<void> {
    const span = await this.findById(spanId);
    if (!span) return;

    // 인덱스에서 제거
    if (span.userId) {
      await this.removeFromUserIndex(span.userId, spanId);
    }
    if (span.sessionId) {
      await this.removeFromSessionIndex(span.sessionId, spanId);
    }

    // Delete Span
    await this.redis.del(this.getSpanKey(spanId));
    this.logger.debug(`Span deleted: ${spanId}`);
  }

  /**
   * user's 모든 Delete Span (GDPR)
   * 
   * @param userId 사용자 ID
   */
  async deleteByUser(userId: string): Promise<number> {
    const spanIds = await this.getSpanIdsByUser(userId);
    
    for (const spanId of spanIds) {
      await this.redis.del(this.getSpanKey(spanId));
    }

    // 인덱스 삭제
    await this.redis.del(this.getUserIndexKey(userId));
    
    this.logger.log(`Deleted ${spanIds.length} spans for user: ${userId}`);
    return spanIds.length;
  }

  // ==================== Public Methods for Sensitive Data ====================

  /**
   * 민감 info filter링 (Requirements 8.5)
   * 
   * metadata에서 API key, 이메일, before화번호, 신용카드, 비밀번호 pattern을 removes.
   * during첩된 object도 재귀적으로 processes.
   * 
   * @param metadata 원본 Metadata
   * @returns 민감 info가 제거된 Metadata
   */
  sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }

    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      // key 자체가 민감한 case 제외
      if (this.isSensitiveKey(key)) {
        this.logger.debug(`Sensitive key filtered: ${key}`);
        continue;
      }

      sanitized[key] = this.sanitizeValue(value);
    }

    return sanitized;
  }

  /**
   * value에서 민감 info pattern 검사 (test용 public 메서드)
   * 
   * @param value 검사할 value
   * @returns 민감 info whether included
   */
  containsSensitiveInfo(value: any): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === 'string') {
      return this.hasSensitivePattern(value);
    }

    if (Array.isArray(value)) {
      return value.some(item => this.containsSensitiveInfo(item));
    }

    if (typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        if (this.isSensitiveKey(key) || this.containsSensitiveInfo(val)) {
          return true;
        }
      }
    }

    return false;
  }

  // ==================== Private Methods ====================

  /**
   * Span Redis에 저장
   */
  private async save(span: Span): Promise<void> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available, skipping span save');
      return;
    }

    const key = this.getSpanKey(span.id);
    await this.redis.setJson(key, span, SpanService.SPAN_TTL_SECONDS);
  }

  /**
   * value에서 민감 info 제거 (재귀적)
   */
  private sanitizeValue(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    // string: pattern 치환
    if (typeof value === 'string') {
      return this.sanitizeString(value);
    }

    // array: 각 요소 처리
    if (Array.isArray(value)) {
      return value.map(item => this.sanitizeValue(item));
    }

    // object: 재귀적 처리
    if (typeof value === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        // 민감한 key는 제외
        if (this.isSensitiveKey(key)) {
          this.logger.debug(`Sensitive nested key filtered: ${key}`);
          continue;
        }
        sanitized[key] = this.sanitizeValue(val);
      }
      return sanitized;
    }

    // 기타 type (number, boolean 등)은 그대로 반환
    return value;
  }

  /**
   * string에서 민감 info pattern 치환
   */
  private sanitizeString(str: string): string {
    let result = str;

    // 모든 민감 info pattern 치환
    for (const [patternName, pattern] of Object.entries(this.SENSITIVE_PATTERNS)) {
      // 정규식 플래그에 'g'가 있으므로 lastIndex 리셋 필요
      pattern.lastIndex = 0;
      if (pattern.test(result)) {
        pattern.lastIndex = 0;
        result = result.replace(pattern, this.REDACTED);
        this.logger.debug(`Sensitive pattern (${patternName}) filtered from string`);
      }
    }

    return result;
  }

  /**
   * string에 민감 info pattern이 있는지 확인
   */
  private hasSensitivePattern(str: string): boolean {
    for (const pattern of Object.values(this.SENSITIVE_PATTERNS)) {
      pattern.lastIndex = 0;
      if (pattern.test(str)) {
        return true;
      }
    }
    return false;
  }

  /**
   * key name이 민감한 info를 나타내는지 확인
   */
  private isSensitiveKey(key: string): boolean {
    const sensitiveKeyPatterns = [
      /^(api[_-]?key|apikey)$/i,
      /^(secret|token|password|pwd|passwd)$/i,
      /^(authorization|auth[_-]?token)$/i,
      /^(access[_-]?token|refresh[_-]?token)$/i,
      /^(private[_-]?key|secret[_-]?key)$/i,
      /^(credit[_-]?card|card[_-]?number)$/i,
      /^(ssn|social[_-]?security)$/i,
    ];

    return sensitiveKeyPatterns.some(pattern => pattern.test(key));
  }

  /**
   * Span이 filter conditions과 일치하는지 확인
   */
  private matchesFilter(span: Span, filter: SpanFilter): boolean {
    // type filter
    if (filter.type && span.type !== filter.type) {
      return false;
    }

    // Whether successful filter
    if (filter.success !== undefined && span.success !== filter.success) {
      return false;
    }

    // time 범above filter
    const spanTime = new Date(span.startTime).getTime();
    if (filter.startTime && spanTime < filter.startTime.getTime()) {
      return false;
    }
    if (filter.endTime && spanTime > filter.endTime.getTime()) {
      return false;
    }

    return true;
  }

  /**
   * Redis key 생성 헬퍼
   */
  private getSpanKey(spanId: string): string {
    return `${this.KEY_PREFIX}${spanId}`;
  }

  private getUserIndexKey(userId: string): string {
    return `${this.USER_LIST_PREFIX}${userId}:list`;
  }

  private getSessionIndexKey(sessionId: string): string {
    return `${this.SESSION_LIST_PREFIX}${sessionId}:list`;
  }

  /**
   * 사용자 인덱스에 Span ID 추가
   */
  private async addToUserIndex(userId: string, spanId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const key = this.getUserIndexKey(userId);
    await this.redis.lpush(key, spanId);
    await this.redis.expire(key, SpanService.SPAN_TTL_SECONDS);
    
    // max 1000개 유지
    await this.redis.ltrim(key, 0, 999);
  }

  /**
   * 세션 인덱스에 Span ID 추가
   */
  private async addToSessionIndex(sessionId: string, spanId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const key = this.getSessionIndexKey(sessionId);
    await this.redis.lpush(key, spanId);
    await this.redis.expire(key, SpanService.SPAN_TTL_SECONDS);
    
    // max 500개 유지
    await this.redis.ltrim(key, 0, 499);
  }

  /**
   * 사용자 인덱스에서 Span ID list 조회
   */
  private async getSpanIdsByUser(userId: string): Promise<string[]> {
    if (!this.redis.isReady()) return [];
    
    const key = this.getUserIndexKey(userId);
    return this.redis.lrange(key, 0, -1);
  }

  /**
   * 세션 인덱스에서 Span ID list 조회
   */
  private async getSpanIdsBySession(sessionId: string): Promise<string[]> {
    if (!this.redis.isReady()) return [];
    
    const key = this.getSessionIndexKey(sessionId);
    return this.redis.lrange(key, 0, -1);
  }

  /**
   * 사용자 인덱스에서 Span ID 제거
   */
  private async removeFromUserIndex(userId: string, spanId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const client = this.redis.getClient();
    if (client) {
      const key = this.getUserIndexKey(userId);
      await client.lrem(key, 0, spanId);
    }
  }

  /**
   * 세션 인덱스에서 Span ID 제거
   */
  private async removeFromSessionIndex(sessionId: string, spanId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const client = this.redis.getClient();
    if (client) {
      const key = this.getSessionIndexKey(sessionId);
      await client.lrem(key, 0, spanId);
    }
  }
}
