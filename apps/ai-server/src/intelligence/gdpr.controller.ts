import {
  Controller,
  Delete,
  Param,
  Get,
  Logger,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { GdprService, GdprDeletionResult } from './gdpr.service';

/**
 * GDPR Controller
 * 
 * Provides GDPR-compliant user data deletion API endpoints.
 * - DELETE /intelligence/user/:userId - Delete user data
 * - GET /intelligence/user/:userId/exists - Check if user data exists
 * 
 * Requirements: 8.4
 */
@Controller('intelligence/user')
export class GdprController {
  private readonly logger = new Logger(GdprController.name);

  constructor(private readonly gdprService: GdprService) {}

  /**
   * DELETE /intelligence/user/:userId
   * Delete all user's data (GDPR)
   * 
   * Deletion targets:
   * - All Span data
   * - All feedback data
   * - All aggregation data
   * 
   * @param userId User ID to delete
   * @returns GdprDeletionResult
   * 
   * Requirements: 8.4
   * Validates: Property 27 - GDPR deletion completeness
   */
  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  async deleteUserData(@Param('userId') userId: string): Promise<GdprDeletionResult> {
    // Validate userId
    if (!userId || userId.trim().length === 0) {
      throw new BadRequestException('userId is required');
    }

    const trimmedUserId = userId.trim();
    
    this.logger.log(`GDPR deletion request received for user: ${trimmedUserId}`);

    const result = await this.gdprService.deleteUserData(trimmedUserId);

    if (!result.success) {
      this.logger.error(`GDPR deletion failed for user: ${trimmedUserId}`);
    }

    return result;
  }

  /**
   * GET /intelligence/user/:userId/exists
   * Check if user data exists
   * 
   * @param userId User ID to check
   * @returns Whether data exists
   */
  @Get(':userId/exists')
  async checkUserDataExists(@Param('userId') userId: string): Promise<{ userId: string; hasData: boolean }> {
    // Validate userId
    if (!userId || userId.trim().length === 0) {
      throw new BadRequestException('userId is required');
    }

    const trimmedUserId = userId.trim();
    const hasData = await this.gdprService.hasUserData(trimmedUserId);

    return {
      userId: trimmedUserId,
      hasData,
    };
  }
}
