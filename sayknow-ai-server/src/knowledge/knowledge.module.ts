import { Module, Global } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';

@Global()
@Module({
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeModule {}
