import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '../memory/redis.service';
import {
  Feedback,
  CreateFeedbackDto,
  FeedbackFilter,
  FeedbackStats,
} from './dto/feedback.dto';
import { SpanService } from './span.service';

/**
 * Feedback Service
 * 
 * Handles user feedback collection and management.
 * Stores in Redis with 30-day TTL.
 * Provides compatible interface with existing backend API (POST /feedback).
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.5, 5.6
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);
  
  // TTL constant (in seconds)
  static readonly FEEDBACK_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days = 2592000 seconds
  
  // Redis key prefixes
  private readonly KEY_PREFIX = 'feedback:';
  private readonly MESSAGE_INDEX_PREFIX = 'feedback:message:';
  private readonly USER_LIST_PREFIX = 'feedback:user:';
  private readonly SPAN_INDEX_PREFIX = 'feedback:span:';

  constructor(
    private readonly redis: RedisService,
    @Inject(forwardRef(() => SpanService))
    private readonly spanService: SpanService,
  ) {}

  /**
   * Create feedback
   * 
   * @param dto Create feedback data
   * @returns Created feedback
   * 
   * Requirements: 5.1, 5.3
   */
  async create(dto: CreateFeedbackDto): Promise<Feedback> {
    const now = new Date().toISOString();
    
    const feedback: Feedback = {
      id: uuidv4(),
      messageId: dto.messageId,
      isGood: dto.isGood,
      comment: dto.comment,
      correctedText: dto.correctedText,
      userId: dto.userId,
      sessionId: dto.sessionId,
      modelUsed: dto.modelUsed,
      createdAt: now,
      updatedAt: now,
    };

    await this.save(feedback);
    
    // Add to messageId index
    await this.setMessageIndex(dto.messageId, feedback.id);
    
    // Add to user index
    if (feedback.userId) {
      await this.addToUserIndex(feedback.userId, feedback.id);
    }

    this.logger.debug(`Feedback created: ${feedback.id} (messageId: ${dto.messageId}, isGood: ${dto.isGood})`);
    return feedback;
  }

  /**
   * Get feedback by ID
   * 
   * @param feedbackId Feedback ID
   * @returns Feedback or null
   */
  async findById(feedbackId: string): Promise<Feedback | null> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available for findById');
      return null;
    }

    const key = this.getFeedbackKey(feedbackId);
    return this.redis.getJson<Feedback>(key);
  }

  /**
   * Get feedback by message ID
   * 
   * @param messageId Message ID
   * @returns Feedback or null
   * 
   * Requirements: 5.6
   */
  async findByMessageId(messageId: string): Promise<Feedback | null> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available for findByMessageId');
      return null;
    }

    const feedbackId = await this.getMessageIndex(messageId);
    if (!feedbackId) {
      return null;
    }

    return this.findById(feedbackId);
  }

  /**
   * Get feedback by user
   * 
   * @param userId User ID
   * @param filter Filter conditions (optional)
   * @returns Feedback list
   * 
   * Requirements: 5.6
   */
  async findByUser(userId: string, filter?: FeedbackFilter): Promise<Feedback[]> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available for findByUser');
      return [];
    }

    const feedbackIds = await this.getFeedbackIdsByUser(userId);
    
    const feedbacks: Feedback[] = [];
    for (const feedbackId of feedbackIds) {
      const feedback = await this.findById(feedbackId);
      if (feedback && this.matchesFilter(feedback, filter)) {
        feedbacks.push(feedback);
      }
    }

    // Sort by time (latest first)
    feedbacks.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Apply limit
    if (filter?.limit && filter.limit > 0) {
      return feedbacks.slice(0, filter.limit);
    }

    return feedbacks;
  }

  /**
   * Get feedback statistics
   * 
   * @param filter filter conditions
   * @returns Feedback statistics
   */
  async getStats(filter: FeedbackFilter): Promise<FeedbackStats> {
    let feedbacks: Feedback[] = [];

    // If userId is present, query only that user's feedback
    if (filter.userId) {
      feedbacks = await this.findByUser(filter.userId, {
        ...filter,
        limit: undefined, // Remove limit for statistics
      });
    }

    const total = feedbacks.length;
    const positive = feedbacks.filter(f => f.isGood).length;
    const negative = total - positive;
    const withComments = feedbacks.filter(f => f.comment && f.comment.trim().length > 0).length;
    const withCorrections = feedbacks.filter(f => f.correctedText && f.correctedText.trim().length > 0).length;

    return {
      total,
      positive,
      negative,
      positiveRate: total > 0 ? positive / total : 0,
      withComments,
      withCorrections,
    };
  }

  /**
   * Link Span and Feedback
   * 
   * Configures bidirectional reference:
   * - Feedback.spanId = spanId
   * - Span.feedbackId = feedbackId
   * 
   * @param feedbackId Feedback ID
   * @param spanId Span ID
   * 
   * Requirements: 5.2
   */
  async linkToSpan(feedbackId: string, spanId: string): Promise<void> {
    // Get feedback
    const feedback = await this.findById(feedbackId);
    if (!feedback) {
      this.logger.warn(`Feedback not found for linkToSpan: ${feedbackId}`);
      return;
    }

    // Get Span
    const span = await this.spanService.findById(spanId);
    if (!span) {
      this.logger.warn(`Span not found for linkToSpan: ${spanId}`);
      return;
    }

    // Set spanId in feedback
    const updatedFeedback: Feedback = {
      ...feedback,
      spanId,
      updatedAt: new Date().toISOString(),
    };
    await this.save(updatedFeedback);

    // Set feedbackId in Span
    await this.spanService.update(spanId, { feedbackId });

    // Add Span index (spanId -> feedbackId)
    await this.setSpanIndex(spanId, feedbackId);

    this.logger.debug(`Linked feedback ${feedbackId} to span ${spanId}`);
  }

  /**
   * Get feedback by Span ID
   * 
   * @param spanId Span ID
   * @returns Feedback or null
   * 
   * Requirements: 5.2
   */
  async findBySpanId(spanId: string): Promise<Feedback | null> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available for findBySpanId');
      return null;
    }

    const feedbackId = await this.getSpanIndex(spanId);
    if (!feedbackId) {
      return null;
    }

    return this.findById(feedbackId);
  }

  /**
   * Delete feedback
   * 
   * @param feedbackId Feedback ID
   */
  async delete(feedbackId: string): Promise<void> {
    const feedback = await this.findById(feedbackId);
    if (!feedback) return;

    // Remove from index
    await this.deleteMessageIndex(feedback.messageId);
    
    if (feedback.userId) {
      await this.removeFromUserIndex(feedback.userId, feedbackId);
    }

    // Remove from Span index
    if (feedback.spanId) {
      await this.deleteSpanIndex(feedback.spanId);
    }

    // Delete feedback
    await this.redis.del(this.getFeedbackKey(feedbackId));
    this.logger.debug(`Feedback deleted: ${feedbackId}`);
  }

  /**
   * Delete all user's feedback (GDPR)
   * 
   * @param userId User ID
   * @returns Number of deleted feedbacks
   */
  async deleteByUser(userId: string): Promise<number> {
    const feedbackIds = await this.getFeedbackIdsByUser(userId);
    
    for (const feedbackId of feedbackIds) {
      const feedback = await this.findById(feedbackId);
      if (feedback) {
        await this.deleteMessageIndex(feedback.messageId);
        // Remove from Span index
        if (feedback.spanId) {
          await this.deleteSpanIndex(feedback.spanId);
        }
        await this.redis.del(this.getFeedbackKey(feedbackId));
      }
    }

    // Delete index
    await this.redis.del(this.getUserIndexKey(userId));
    
    this.logger.log(`Deleted ${feedbackIds.length} feedbacks for user: ${userId}`);
    return feedbackIds.length;
  }

  // ==================== Private Methods ====================

  /**
   * Save feedback to Redis
   */
  private async save(feedback: Feedback): Promise<void> {
    if (!this.redis.isReady()) {
      this.logger.warn('Redis not available, skipping feedback save');
      return;
    }

    const key = this.getFeedbackKey(feedback.id);
    await this.redis.setJson(key, feedback, FeedbackService.FEEDBACK_TTL_SECONDS);
  }

  /**
   * Check if feedback matches filter conditions
   */
  private matchesFilter(feedback: Feedback, filter?: FeedbackFilter): boolean {
    if (!filter) return true;

    // isGood filter
    if (filter.isGood !== undefined && feedback.isGood !== filter.isGood) {
      return false;
    }

    // sessionId filter
    if (filter.sessionId && feedback.sessionId !== filter.sessionId) {
      return false;
    }

    // Time range filter
    const feedbackTime = new Date(feedback.createdAt).getTime();
    if (filter.startTime && feedbackTime < filter.startTime.getTime()) {
      return false;
    }
    if (filter.endTime && feedbackTime > filter.endTime.getTime()) {
      return false;
    }

    return true;
  }

  /**
   * Redis key generation helpers
   */
  private getFeedbackKey(feedbackId: string): string {
    return `${this.KEY_PREFIX}${feedbackId}`;
  }

  private getMessageIndexKey(messageId: string): string {
    return `${this.MESSAGE_INDEX_PREFIX}${messageId}`;
  }

  private getUserIndexKey(userId: string): string {
    return `${this.USER_LIST_PREFIX}${userId}:list`;
  }

  /**
   * Set message index (messageId -> feedbackId)
   */
  private async setMessageIndex(messageId: string, feedbackId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const key = this.getMessageIndexKey(messageId);
    await this.redis.set(key, feedbackId, FeedbackService.FEEDBACK_TTL_SECONDS);
  }

  /**
   * Get message index
   */
  private async getMessageIndex(messageId: string): Promise<string | null> {
    if (!this.redis.isReady()) return null;
    
    const key = this.getMessageIndexKey(messageId);
    return this.redis.get(key);
  }

  /**
   * Delete message index
   */
  private async deleteMessageIndex(messageId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const key = this.getMessageIndexKey(messageId);
    await this.redis.del(key);
  }

  /**
   * Add feedback ID to user index
   */
  private async addToUserIndex(userId: string, feedbackId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const key = this.getUserIndexKey(userId);
    await this.redis.lpush(key, feedbackId);
    await this.redis.expire(key, FeedbackService.FEEDBACK_TTL_SECONDS);
    
    // Keep max 1000 items
    await this.redis.ltrim(key, 0, 999);
  }

  /**
   * Get feedback ID list from user index
   */
  private async getFeedbackIdsByUser(userId: string): Promise<string[]> {
    if (!this.redis.isReady()) return [];
    
    const key = this.getUserIndexKey(userId);
    return this.redis.lrange(key, 0, -1);
  }

  /**
   * Remove feedback ID from user index
   */
  private async removeFromUserIndex(userId: string, feedbackId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const client = this.redis.getClient();
    if (client) {
      const key = this.getUserIndexKey(userId);
      await client.lrem(key, 0, feedbackId);
    }
  }

  /**
   * Generate Span index key
   */
  private getSpanIndexKey(spanId: string): string {
    return `${this.SPAN_INDEX_PREFIX}${spanId}`;
  }

  /**
   * Set Span index (spanId -> feedbackId)
   */
  private async setSpanIndex(spanId: string, feedbackId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const key = this.getSpanIndexKey(spanId);
    await this.redis.set(key, feedbackId, FeedbackService.FEEDBACK_TTL_SECONDS);
  }

  /**
   * Get Span index
   */
  private async getSpanIndex(spanId: string): Promise<string | null> {
    if (!this.redis.isReady()) return null;
    
    const key = this.getSpanIndexKey(spanId);
    return this.redis.get(key);
  }

  /**
   * Delete Span index
   */
  private async deleteSpanIndex(spanId: string): Promise<void> {
    if (!this.redis.isReady()) return;
    
    const key = this.getSpanIndexKey(spanId);
    await this.redis.del(key);
  }
}
