import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { SignatureGuard } from './auth/signature.guard';
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
  providers: [
    // Deny-by-default auth: SignatureGuard runs on EVERY route unless the route
    // is marked @Public(). This replaces per-controller @UseGuards, so a newly
    // added controller is authenticated automatically instead of shipping open
    // (CODE-REVIEW C13). SignatureGuard is provided+exported by AuthModule.
    { provide: APP_GUARD, useExisting: SignatureGuard },
  ],
})
export class AppModule {}
