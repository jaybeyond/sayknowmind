import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service';
import { UserMemoryService } from './user-memory.service';
import { SessionContextService } from './session-context.service';
import { GlobalLearningService } from './global-learning.service';
import { ContextBuilderService } from './context-builder.service';
import { SemanticMemoryService } from './semantic-memory.service';
import { EntityStoreService } from './entity-store.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    RedisService,
    UserMemoryService,
    SessionContextService,
    GlobalLearningService,
    ContextBuilderService,
    SemanticMemoryService,
    EntityStoreService,
  ],
  exports: [
    RedisService,
    UserMemoryService,
    SessionContextService,
    GlobalLearningService,
    ContextBuilderService,
    SemanticMemoryService,
    EntityStoreService,
  ],
})
export class MemoryModule {}
