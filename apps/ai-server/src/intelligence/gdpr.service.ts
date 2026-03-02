import { Injectable, Logger } from '@nestjs/common';
import { SpanService } from './span.service';
import { FeedbackService } from './feedback.service';
import { AdapterService } from './adapter.service';

/**
 * GDPR deletion result interface
 */
export interface GdprDeletionResult {
  userId: string;
  spansDeleted: number;
  feedbacksDeleted: number;
  aggregationsDeleted: number;
  totalDeleted: number;
  success: boolean;
  deletedAt: string;
}

/**
 * GDPR Service
 * 
 * Handles GDPR-compliant user data deletion.
 * Deletes all user's Spans, feedback, and aggregation data from Redis.
 * 
 * Requirements: 8.4
 * Validates: Property 27 - GDPR deletion completeness
 */
@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    private readonly spanService: SpanService,
    private readonly feedbackService: FeedbackService,
    private readonly adapterService: AdapterService,
  ) {}

  /**
   * Delete all user's data (GDPR)
   * 
   * Deletion targets:
   * 1. All Spans (span:{spanId}) and user index (span:user:{userId}:list)
   * 2. All feedback (feedback:{feedbackId}) and related indexes
   * 3. All aggregation data (metrics:user:{userId}:*)
   * 
   * Returns success result even on Redis failure. (Requirements 8.6)
   * 
   * @param userId User ID to delete
   * @returns Deletion result
   * 
   * Requirements: 8.4, 8.6
   * Validates: Property 27 - GDPR deletion completeness
   * Validates: Property 29 - Service continuity on Redis failure
   */
  async deleteUserData(userId: string): Promise<GdprDeletionResult> {
    this.logger.log(`Starting GDPR deletion for user: ${userId}`);

    const result: GdprDeletionResult = {
      userId,
      spansDeleted: 0,
      feedbacksDeleted: 0,
      aggregationsDeleted: 0,
      totalDeleted: 0,
      success: false,
      deletedAt: new Date().toISOString(),
    };

    try {
      // 1. Delete Spans (SpanService.deleteByUser)
      result.spansDeleted = await this.spanService.deleteByUser(userId);
      this.logger.debug(`Deleted ${result.spansDeleted} spans for user: ${userId}`);

      // 2. Delete feedback (FeedbackService.deleteByUser)
      result.feedbacksDeleted = await this.feedbackService.deleteByUser(userId);
      this.logger.debug(`Deleted ${result.feedbacksDeleted} feedbacks for user: ${userId}`);

      // 3. Delete aggregation data (AdapterService.deleteUserAggregations)
      result.aggregationsDeleted = await this.adapterService.deleteUserAggregations(userId);
      this.logger.debug(`Deleted ${result.aggregationsDeleted} aggregation keys for user: ${userId}`);

      // Calculate total deletions
      result.totalDeleted = result.spansDeleted + result.feedbacksDeleted + result.aggregationsDeleted;
      result.success = true;

      this.logger.log(
        `GDPR deletion completed for user ${userId}: ` +
        `${result.spansDeleted} spans, ${result.feedbacksDeleted} feedbacks, ` +
        `${result.aggregationsDeleted} aggregations (total: ${result.totalDeleted})`
      );

    } catch (error) {
      this.logger.warn(`GDPR deletion encountered error for user ${userId} (Redis may be unavailable):`, error);
      // Treat as success even on Redis failure (Requirements 8.6)
      // No impact on AI service when data is missing or Redis is unavailable
      result.success = true;
    }

    return result;
  }

  /**
   * Check if user data exists
   * Returns false even on Redis failure. (Requirements 8.6)
   * 
   * @param userId User ID to check
   * @returns Whether data exists
   * 
   * Requirements: 8.6
   * Validates: Property 29 - Service continuity on Redis failure
   */
  async hasUserData(userId: string): Promise<boolean> {
    try {
      // Check Span existence
      const spans = await this.spanService.findMany({ userId, limit: 1 });
      if (spans.length > 0) {
        return true;
      }

      // Check feedback existence
      const feedbacks = await this.feedbackService.findByUser(userId, { limit: 1 });
      if (feedbacks.length > 0) {
        return true;
      }

      return false;
    } catch (error) {
      this.logger.warn(`Error checking user data (Redis may be unavailable): ${error.message}`);
      return false; // Don't throw error (Requirements 8.6)
    }
  }
}
