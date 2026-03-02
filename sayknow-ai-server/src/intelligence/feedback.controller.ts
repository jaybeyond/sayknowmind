import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Delete,
  Logger,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto, FeedbackFilter } from './dto/feedback.dto';

/**
 * Feedback Controller
 * 
 * 피드백 API 엔드포인트를 provides.
 * existing 백엔드 /feedback API와 동일한 DTO를 지원does.
 * 
 * Requirements: 5.5
 */
@Controller('intelligence/feedback')
export class FeedbackController {
  private readonly logger = new Logger(FeedbackController.name);

  constructor(private readonly feedbackService: FeedbackService) {}

  /**
   * POST /intelligence/feedback
   * Create feedback
   * existing 백엔드 /feedback API와 동일한 DTO 지원
   */
  @Post()
  async create(@Body() dto: CreateFeedbackDto) {
    this.logger.log(`Creating feedback for messageId: ${dto.messageId}, isGood: ${dto.isGood}`);
    return this.feedbackService.create(dto);
  }

  /**
   * GET /intelligence/feedback/stats
   * Get feedback statistics
   * 
   * Note: 이 라우트는 :id 라우트보다 먼저 definition되어야 does.
   * 그렇지 않으면 'stats'가 id로 인식is done.
   */
  @Get('stats')
  async getStats(@Query('userId') userId?: string) {
    this.logger.log(`Getting feedback stats for userId: ${userId || 'all'}`);
    return this.feedbackService.getStats({ userId });
  }

  /**
   * GET /intelligence/feedback/message/:messageId
   * 메시지 ID로 Get feedback
   * 
   * Note: 이 라우트는 :id 라우트보다 먼저 definition되어야 does.
   */
  @Get('message/:messageId')
  async findByMessageId(@Param('messageId') messageId: string) {
    this.logger.log(`Finding feedback by messageId: ${messageId}`);
    return this.feedbackService.findByMessageId(messageId);
  }

  /**
   * GET /intelligence/feedback/user/:userId
   * per user Get feedback
   * 
   * Note: 이 라우트는 :id 라우트보다 먼저 definition되어야 does.
   */
  @Get('user/:userId')
  async findByUser(
    @Param('userId') userId: string,
    @Query('isGood') isGood?: string,
    @Query('limit') limit?: string,
  ) {
    this.logger.log(`Finding feedbacks for userId: ${userId}, isGood: ${isGood}, limit: ${limit}`);
    
    const filter: FeedbackFilter = {};
    if (isGood !== undefined) {
      filter.isGood = isGood === 'true';
    }
    if (limit) {
      filter.limit = parseInt(limit, 10);
    }
    return this.feedbackService.findByUser(userId, filter);
  }

  /**
   * GET /intelligence/feedback/:id
   * ID로 Get feedback
   */
  @Get(':id')
  async findById(@Param('id') id: string) {
    this.logger.log(`Finding feedback by id: ${id}`);
    return this.feedbackService.findById(id);
  }

  /**
   * POST /intelligence/feedback/:id/link/:spanId
   * Link feedback to Span
   */
  @Post(':id/link/:spanId')
  async linkToSpan(
    @Param('id') feedbackId: string,
    @Param('spanId') spanId: string,
  ) {
    this.logger.log(`Linking feedback ${feedbackId} to span ${spanId}`);
    await this.feedbackService.linkToSpan(feedbackId, spanId);
    return { success: true };
  }

  /**
   * DELETE /intelligence/feedback/:id
   * Delete feedback
   */
  @Delete(':id')
  async delete(@Param('id') id: string) {
    this.logger.log(`Deleting feedback: ${id}`);
    await this.feedbackService.delete(id);
    return { success: true };
  }
}
