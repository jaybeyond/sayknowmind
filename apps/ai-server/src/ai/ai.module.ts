import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AIRouterService } from './ai-router.service';
import { ZaiService } from './zai.service';
import { CloudflareService } from './cloudflare.service';
import { OpenRouterService } from './openrouter.service';
import { UpstageService } from './upstage.service';
import { NvidiaService } from './nvidia.service';
import { VeniceService } from './venice.service';
import { GrokService } from './grok.service';
import { PromptManagerService } from './prompt-manager.service';
import { OCRModule } from '../ocr/ocr.module';
import { SearchModule } from '../search/search.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';

@Module({
  imports: [OCRModule, SearchModule, IntelligenceModule],
  controllers: [AIController],
  providers: [AIRouterService, ZaiService, CloudflareService, OpenRouterService, UpstageService, NvidiaService, VeniceService, GrokService, PromptManagerService],
  exports: [AIRouterService, ZaiService, CloudflareService, OpenRouterService, UpstageService, NvidiaService, VeniceService, GrokService, PromptManagerService],
})
export class AIModule {}
