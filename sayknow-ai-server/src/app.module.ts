import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AIModule } from './ai/ai.module';
import { OCRModule } from './ocr/ocr.module';
import { SearchModule } from './search/search.module';
import { HealthModule } from './health/health.module';
import { MemoryModule } from './memory/memory.module';
import { KnowledgeModule } from './knowledge/knowledge.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    ThrottlerModule.forRoot([{
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60') * 1000,
      limit: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    }]),
    MemoryModule, // Memory system (Redis-based)
    KnowledgeModule, // Knowledge base system
    AuthModule,
    AIModule,
    OCRModule,
    SearchModule,
    HealthModule,
  ],
})
export class AppModule {}
