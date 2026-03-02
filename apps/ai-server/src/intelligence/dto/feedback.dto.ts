/**
 * Feedback DTO definitions
 * 
 * Defines user feedback data structures.
 * Provides interfaces compatible with the existing backend API.
 * 
 * Requirements: 5.1, 5.3, 5.5, 5.6
 */

/**
 * Feedback interface
 * 
 * Represents feedback provided by a user on an AI response.
 */
export interface Feedback {
  id: string;
  messageId: string;
  spanId?: string;
  
  isGood: boolean;
  comment?: string;
  correctedText?: string;
  
  // Metadata
  userId?: string;
  sessionId?: string;
  modelUsed?: string;
  
  createdAt: string;
  updatedAt: string;
}

/**
 * Create feedback DTO
 * 
 * Used when creating new feedback.
 * Compatible with the existing backend POST /feedback API.
 */
export interface CreateFeedbackDto {
  messageId: string;
  isGood: boolean;
  comment?: string;
  correctedText?: string;
  userId?: string;
  sessionId?: string;
  modelUsed?: string;
}

/**
 * Feedback filter interface
 * 
 * Filter conditions used when querying feedback.
 */
export interface FeedbackFilter {
  userId?: string;
  sessionId?: string;
  isGood?: boolean;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

/**
 * Feedback stats interface
 * 
 * Represents aggregated statistics of feedback data.
 */
export interface FeedbackStats {
  total: number;
  positive: number;
  negative: number;
  positiveRate: number;
  withComments: number;
  withCorrections: number;
}
