import { Injectable, Logger } from '@nestjs/common';
import { SpanService } from './span.service';
import { RedisService } from '../memory/redis.service';
import {
  Span,
  SpanType,
  SpanStatus,
  StartSpanOptions,
  SpanResult,
} from './dto/span.dto';

/**
 * Tracer Service
 * 
 * Core service that automatically instruments AI calls.
 * Traces asynchronously to avoid affecting AI response latency.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4
 * 
 * - 1.1: Automatically creates new Span on AI call start and records request info
 * - 1.2: Records response info, elapsed time, and tokens used in Span on AI call completion
 * - 1.3: Records error info and fallback status in Span on AI call failure
 * - 1.4: Traces asynchronously to avoid affecting AI response latency
 */
@Injectable()
export class TracerService {
  private readonly logger = new Logger(TracerService.name);
  
  /**
   * Cache active Spans in memory (for fast lookup)
   */
  private readonly activeSpans = new Map<string, Span>();

  constructor(
    private readonly spanService: SpanService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Create Span on AI call start
   * 
   * Synchronously creates and returns Span object.
   * Redis save is handled asynchronously to avoid affecting AI response latency.
   * AI service operates normally even on Redis failure. (Requirements 8.6)
   * 
   * @param options Create Span options
   * @returns Created Span
   * 
   * Requirements: 1.1, 1.4, 8.6
   */
  startSpan(options: StartSpanOptions): Span {
    const startTime = new Date().toISOString();
    const spanId = this.generateSpanId();
    
    // Create Span object (sync)
    const span: Span = {
      id: spanId,
      type: options.type,
      status: SpanStatus.STARTED,
      userId: options.userId,
      sessionId: options.sessionId,
      parentSpanId: options.parentSpanId,
      startTime,
      metadata: options.metadata || {},
    };

    // Store in active Span cache
    this.activeSpans.set(span.id, span);

    // Check Redis connection status (Requirements 8.6: Service continuity on Redis failure)
    if (!this.redis.isReady()) {
      this.logger.warn(`Redis not available, skipping span save for: ${span.id}`);
      // Return Span object even if Redis is unavailable so AI service operates normally
      return span;
    }

    // Save to Redis asynchronously (no impact on AI response latency)
    Promise.resolve().then(async () => {
      try {
        await this.spanService.createWithId(spanId, {
          type: options.type,
          userId: options.userId,
          sessionId: options.sessionId,
          parentSpanId: options.parentSpanId,
          metadata: options.metadata,
        });
        this.logger.debug(`Span started: ${span.id} (type: ${span.type})`);
      } catch (error) {
        this.logger.warn(`Failed to save span start (Redis may be unavailable): ${span.id}`, error);
        // No impact on AI service even on error (Requirements 8.6)
      }
    });

    return span;
  }

  /**
   * End Span on AI call completion
   * 
   * Records response info, elapsed time, and tokens used in Span.
   * Processed asynchronously to avoid affecting AI response latency.
   * AI service operates normally even on Redis failure. (Requirements 8.6)
   * 
   * @param spanId Span ID
   * @param result Span result info
   * 
   * Requirements: 1.2, 1.4, 8.6
   */
  async endSpan(spanId: string, result: SpanResult): Promise<void> {
    const endTime = new Date().toISOString();
    
    // Lookup from active Span cache
    const cachedSpan = this.activeSpans.get(spanId);
    
    // Check Redis connection status (Requirements 8.6: Service continuity on Redis failure)
    if (!this.redis.isReady()) {
      this.logger.warn(`Redis not available, skipping span end for: ${spanId}`);
      // Remove from active Span cache
      this.activeSpans.delete(spanId);
      return; // Don't throw error
    }
    
    // Update Redis asynchronously (save after Promise.resolve)
    Promise.resolve().then(async () => {
      try {
        await this.spanService.update(spanId, {
          status: result.success ? SpanStatus.COMPLETED : SpanStatus.FAILED,
          endTime,
          latencyMs: result.latencyMs,
          modelUsed: result.modelUsed,
          tokensUsed: result.tokensUsed,
          fallbackUsed: result.fallbackUsed,
          success: result.success,
          responseLength: result.responseLength,
        });
        
        this.logger.debug(
          `Span ended: ${spanId} (success: ${result.success}, latency: ${result.latencyMs}ms)`
        );
      } catch (error) {
        this.logger.warn(`Failed to save span end (Redis may be unavailable): ${spanId}`, error);
        // No impact on AI service even on error (Requirements 8.6)
      } finally {
        // Remove from active Span cache
        this.activeSpans.delete(spanId);
      }
    });
  }

  /**
   * Record error in Span on error occurrence
   * 
   * Records error info and fallback status in Span.
   * Processed asynchronously to avoid affecting AI response latency.
   * AI service operates normally even on Redis failure. (Requirements 8.6)
   * 
   * @param spanId Span ID
   * @param error Occurred error
   * @param fallbackUsed Whether fallback was used (optional)
   * 
   * Requirements: 1.3, 1.4, 8.6
   */
  async recordError(spanId: string, error: Error, fallbackUsed?: boolean): Promise<void> {
    const endTime = new Date().toISOString();
    
    // Lookup from active Span cache to calculate latency
    const cachedSpan = this.activeSpans.get(spanId);
    let latencyMs: number | undefined;
    
    if (cachedSpan) {
      const startTime = new Date(cachedSpan.startTime).getTime();
      const endTimeMs = new Date(endTime).getTime();
      latencyMs = endTimeMs - startTime;
    }

    // Check Redis connection status (Requirements 8.6: Service continuity on Redis failure)
    if (!this.redis.isReady()) {
      this.logger.warn(`Redis not available, skipping span error record for: ${spanId}`);
      // Remove from active Span cache
      this.activeSpans.delete(spanId);
      return; // Don't throw error
    }

    // Update Redis asynchronously (save after Promise.resolve)
    Promise.resolve().then(async () => {
      try {
        await this.spanService.update(spanId, {
          status: SpanStatus.FAILED,
          endTime,
          latencyMs,
          success: false,
          errorMessage: this.sanitizeErrorMessage(error),
          fallbackUsed: fallbackUsed ?? false,
        });
        
        this.logger.debug(
          `Span error recorded: ${spanId} (error: ${error.message}, fallback: ${fallbackUsed})`
        );
      } catch (updateError) {
        this.logger.warn(`Failed to save span error (Redis may be unavailable): ${spanId}`, updateError);
        // No impact on AI service even on error (Requirements 8.6)
      } finally {
        // Remove from active Span cache
        this.activeSpans.delete(spanId);
      }
    });
  }

  /**
   * Get active Span (from cache)
   * 
   * @param spanId Span ID
   * @returns Active Span or undefined
   */
  getActiveSpan(spanId: string): Span | undefined {
    return this.activeSpans.get(spanId);
  }

  /**
   * Get active Span count
   * 
   * @returns Active Span count
   */
  getActiveSpanCount(): number {
    return this.activeSpans.size;
  }

  /**
   * Check if tracing is available
   * 
   * Tracing is always attempted regardless of Redis connection status.
   * AI service operates normally even when Redis is unavailable.
   * 
   * @returns Whether tracing is available
   */
  isTracingEnabled(): boolean {
    return this.redis.isReady();
  }

  // ==================== Private Methods ====================

  /**
   * Generate unique Span ID
   * 
   * Creates unique ID in UUID v4 format.
   */
  private generateSpanId(): string {
    // Generate UUID v4 format
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Sanitize error message
   * 
   * Removes sensitive info and returns safe error message.
   * 
   * @param error Original error
   * @returns Sanitized error message
   */
  private sanitizeErrorMessage(error: Error): string {
    let message = error.message || 'Unknown error';
    
    // Remove API key patterns
    message = message.replace(/sk-[a-zA-Z0-9]+/g, '[API_KEY_REDACTED]');
    message = message.replace(/pk-[a-zA-Z0-9]+/g, '[API_KEY_REDACTED]');
    message = message.replace(/api[_-]?key[=:]\s*[^\s,}]+/gi, 'api_key=[REDACTED]');
    
    // Remove Bearer tokens
    message = message.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
    
    // Limit message length (max 500 chars)
    if (message.length > 500) {
      message = message.substring(0, 497) + '...';
    }
    
    return message;
  }
}
