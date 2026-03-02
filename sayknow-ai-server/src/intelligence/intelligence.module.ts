import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SpanService } from './span.service';
import { TracerService } from './tracer.service';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { AdapterService } from './adapter.service';
import { AlgorithmService } from './algorithm.service';
import { GdprService } from './gdpr.service';
import { GdprController } from './gdpr.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { MemoryModule } from '../memory/memory.module';

// Re-export decorators for easy access
export { Trace, TraceAll, InjectTracer, TraceOptions, TRACER_SERVICE } from './trace.decorator';

/**
 * Intelligence Module
 * 
 * AI 호출 추적, 학습, 최적화를 담당하는 moduleis.
 * 
 * 포함 service:
 * - TracerService: AI 호출 Auto tracing
 * - SpanService: Span data CRUD
 * - AdapterService: data 변환 및 집계
 * - AlgorithmService: 학습 및 최적화
 * - FeedbackService: feedback collection
 * - AnalyticsService: 성능 분석
 * - GdprService: GDPR 준수 data 삭제
 * 
 * controller:
 * - FeedbackController: 피드백 API 엔드포인트
 * - GdprController: GDPR 삭제 API 엔드포인트
 * - AnalyticsController: 분석 API 엔드포인트
 * 
 * decorator:
 * - @Trace: 메서드 자동 Trace decorator
 * - @TraceAll: 클래스의 모든 async 메서드 Auto tracing
 * - @InjectTracer: TracerService injection decorator
 * 
 * dependency:
 * - MemoryModule: Redis, GlobalLearning 등 memory service 제공
 */
@Module({
  imports: [ConfigModule, MemoryModule],
  controllers: [FeedbackController, GdprController, AnalyticsController],
  providers: [
    SpanService,
    TracerService,
    FeedbackService,
    AdapterService,
    AlgorithmService,
    GdprService,
    AnalyticsService,
  ],
  exports: [
    SpanService,
    TracerService,
    FeedbackService,
    AdapterService,
    AlgorithmService,
    GdprService,
    AnalyticsService,
  ],
})
export class IntelligenceModule {}
