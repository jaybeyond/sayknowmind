import {
  Controller,
  Get,
  Query,
  Logger,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import {
  TimeWindow,
  DashboardData,
  ModelMetrics,
  CostAnalysis,
  DashboardFilter,
} from './dto/analytics.dto';

/**
 * Analytics Controller
 * 
 * 분석 API 엔드포인트를 provides.
 * - GET /intelligence/analytics/dashboard - dashboard data
 * - GET /intelligence/analytics/models - metrics by model
 * - GET /intelligence/analytics/cost - Cost analysis
 * 
 * Requirements: 6.1, 6.2, 6.4
 */
@Controller('intelligence/analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  // valid한 time 윈도우 value
  private readonly VALID_TIME_WINDOWS: TimeWindow[] = ['1h', '24h', '7d', '30d'];

  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /intelligence/analytics/dashboard
   * Get dashboard data
   * 
   * @param timeWindow time 윈도우 (default: '24h')
   * @param userId optional적 사용자 ID
   * @param model optional적 모델 filter
   * @returns DashboardData
   * 
   * Requirements: 6.2
   */
  @Get('dashboard')
  async getDashboard(
    @Query('timeWindow') timeWindow?: string,
    @Query('userId') userId?: string,
    @Query('model') model?: string,
  ): Promise<DashboardData> {
    const validatedTimeWindow = this.validateTimeWindow(timeWindow);
    
    this.logger.log(
      `Getting dashboard data: timeWindow=${validatedTimeWindow}, userId=${userId || 'all'}, model=${model || 'all'}`,
    );

    const filter: DashboardFilter = {
      timeWindow: validatedTimeWindow,
      userId,
      model,
    };

    return this.analyticsService.getDashboardData(filter);
  }

  /**
   * GET /intelligence/analytics/models
   * Get metrics by model
   * 
   * @param timeWindow time 윈도우 (default: '24h')
   * @param userId optional적 사용자 ID
   * @returns ModelMetrics[]
   * 
   * Requirements: 6.1
   */
  @Get('models')
  async getModelMetrics(
    @Query('timeWindow') timeWindow?: string,
    @Query('userId') userId?: string,
  ): Promise<ModelMetrics[]> {
    const validatedTimeWindow = this.validateTimeWindow(timeWindow);
    
    this.logger.log(
      `Getting model metrics: timeWindow=${validatedTimeWindow}, userId=${userId || 'all'}`,
    );

    return this.analyticsService.getModelMetrics(validatedTimeWindow, userId);
  }

  /**
   * GET /intelligence/analytics/cost
   * Cost analysis 조회
   * 
   * @param timeWindow time 윈도우 (default: '24h')
   * @param userId optional적 사용자 ID
   * @returns CostAnalysis
   * 
   * Requirements: 6.4
   */
  @Get('cost')
  async getCostAnalysis(
    @Query('timeWindow') timeWindow?: string,
    @Query('userId') userId?: string,
  ): Promise<CostAnalysis> {
    const validatedTimeWindow = this.validateTimeWindow(timeWindow);
    
    this.logger.log(
      `Getting cost analysis: timeWindow=${validatedTimeWindow}, userId=${userId || 'all'}`,
    );

    return this.analyticsService.getCostAnalysis(validatedTimeWindow, userId);
  }

  /**
   * time 윈도우 valid성 검사
   * valid하지 않은 value이면 default '24h' 반환
   * 
   * @param timeWindow 입력된 time 윈도우
   * @returns valid한 TimeWindow
   */
  private validateTimeWindow(timeWindow?: string): TimeWindow {
    if (timeWindow && this.VALID_TIME_WINDOWS.includes(timeWindow as TimeWindow)) {
      return timeWindow as TimeWindow;
    }
    return '24h'; // default
  }
}
