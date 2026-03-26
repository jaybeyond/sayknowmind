import {
  Controller,
  Post,
  Put,
  Body,
  UseGuards,
  Res,
  Logger,
  UploadedFiles,
  UseInterceptors,
  Get,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { SignatureGuard } from '../auth/signature.guard';
import { CryptoService } from '../auth/crypto.service';
import { AIRouterService } from './ai-router.service';
import { OCRService } from '../ocr/ocr.service';
import { SearchService } from '../search/search.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';
import { ContextBuilderService } from '../memory/context-builder.service';
import { UserMemoryService } from '../memory/user-memory.service';
import { SessionContextService } from '../memory/session-context.service';
import { GlobalLearningService } from '../memory/global-learning.service';
import { SemanticMemoryService } from '../memory/semantic-memory.service';
import { EntityStoreService } from '../memory/entity-store.service';
import { TracerService } from '../intelligence/tracer.service';
import { SpanType } from '../intelligence/dto/span.dto';
import { SAYKNOWBOT_TOOLS } from './sayknowbot-tools';
import { OpenRouterService } from './openrouter.service';
import { PromptManagerService } from './prompt-manager.service';
import { KnowledgeBaseService } from '../knowledge/knowledge-base.service';

@Controller('ai')
@UseGuards(SignatureGuard)
export class AIController {
  private readonly logger = new Logger(AIController.name);

  constructor(
    private readonly aiRouterService: AIRouterService,
    private readonly ocrService: OCRService,
    private readonly searchService: SearchService,
    private readonly cryptoService: CryptoService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly userMemory: UserMemoryService,
    private readonly sessionContext: SessionContextService,
    private readonly globalLearning: GlobalLearningService,
    private readonly semanticMemory: SemanticMemoryService,
    private readonly entityStore: EntityStoreService,
    private readonly tracer: TracerService,
    private readonly openRouterService: OpenRouterService,
    private readonly promptManager: PromptManagerService,
    private readonly knowledgeBase: KnowledgeBaseService,
  ) {}

  /**
   * Get all prompts
   */
  @Get('prompts')
  getPrompts() {
    return this.promptManager.getAll();
  }

  /**
   * Update all/partial prompts
   */
  @Post('prompts')
  updatePrompts(@Body() body: any) {
    this.promptManager.updateAll(body);
    return this.promptManager.getAll();
  }

  /**
   * Update model-specific prompt
   */
  @Post('prompts/model/:model')
  updateModelPrompt(@Param('model') model: 'pro' | 'flash' | 'lite', @Body() body: { prompt: string }) {
    this.promptManager.updateModelPrompt(model, body.prompt);
    return { model, prompt: body.prompt };
  }

  /**
   * Reload prompts (after direct file modification)
   */
  @Post('prompts/reload')
  reloadPrompts() {
    return this.promptManager.reload();
  }

  /**
   * Backward compatible: legacy system-prompt API
   */
  @Get('system-prompt')
  getSystemPrompt() {
    return { prompt: this.promptManager.getModelPrompt('pro') };
  }

  @Post('system-prompt')
  updateSystemPrompt(@Body() body: { prompt: string }) {
    if (body.prompt) {
      this.promptManager.updateModelPrompt('pro', body.prompt);
    }
    return { prompt: this.promptManager.getModelPrompt('pro') };
  }

  /**
   * Get model list (from AI Router)
   */
  @Get('models')
  getModels() {
    const models = this.aiRouterService.getModels();
    return { ...models, local: this.loadLocalModels() };
  }

  /**
   * Get local model list
   */
  @Get('models/local')
  getLocalModels() {
    return this.loadLocalModels();
  }

  /**
   * Update all local models (including reorder, add, delete)
   */
  @Put('models/local')
  updateLocalModels(@Body() body: { items: any[] }) {
    if (!body.items || !Array.isArray(body.items)) {
      return { error: 'items array is required' };
    }
    this.saveLocalModels(body.items);
    return { success: true, items: body.items };
  }

  private loadLocalModels(): any[] {
    try {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(process.cwd(), 'data', 'local-models.json');
      if (!fs.existsSync(filePath)) return [];
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch { return []; }
  }

  private saveLocalModels(items: any[]) {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(process.cwd(), 'data', 'local-models.json');
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf-8');
    this.logger.log(`✅ Local models saved: ${items.length} items`);
  }

  /**
   * Update cascade (Pro/Flash/Thinking)
   */
  @Post('models/cascade/:role')
  updateCascade(
    @Param('role') role: 'pro' | 'flash' | 'thinking',
    @Body() body: { items: Array<{ type: string; model: string; name: string }> },
  ) {
    if (!['pro', 'flash', 'thinking'].includes(role)) {
      return { error: 'Invalid role. Use pro, flash, or thinking.' };
    }
    if (!body.items || !Array.isArray(body.items)) {
      return { error: 'items array is required' };
    }
    return this.aiRouterService.updateCascade(role, body.items);
  }

  /**
   * Update entire cascade config
   */
  @Post('models/cascade')
  updateAllCascades(@Body() body: any) {
    return this.aiRouterService.updateAllCascades(body);
  }

  /**
   * Reload cascade config
   */
  @Post('models/reload')
  reloadCascade() {
    return this.aiRouterService.reloadCascade();
  }

  /**
   * Update provider API keys at runtime.
   * Called by the web app when user saves provider settings.
   */
  @Put('keys')
  updateProviderKeys(@Body() body: Record<string, string>) {
    this.aiRouterService.updateProviderKeys(body);
    return { ok: true, updated: Object.keys(body) };
  }

  // ===== Knowledge Base API =====

  @Get('knowledge')
  getKnowledgeBases() {
    return this.knowledgeBase.getAll();
  }

  @Post('knowledge')
  createKnowledgeBase(@Body() body: { name: string; description: string; keywords: string; imageUrl?: string; resources?: any[] }) {
    return this.knowledgeBase.createBase(body);
  }

  @Post('knowledge/:id')
  updateKnowledgeBase(@Param('id') id: string, @Body() body: any) {
    const result = this.knowledgeBase.updateBase(id, body);
    if (!result) return { error: 'Knowledge base not found' };
    return result;
  }

  @Delete('knowledge/:id')
  deleteKnowledgeBase(@Param('id') id: string) {
    const ok = this.knowledgeBase.deleteBase(id);
    if (!ok) return { error: 'Knowledge base not found' };
    return { message: 'Deleted' };
  }

  @Post('knowledge/:id/entries')
  addKnowledgeEntry(
    @Param('id') baseId: string,
    @Body() body: { content: string; source?: string; imageUrl?: string },
  ) {
    const entry = this.knowledgeBase.addEntry(baseId, body.content, body.source, body.imageUrl);
    if (!entry) return { error: 'Knowledge base not found' };
    return entry;
  }

  @Delete('knowledge/:baseId/entries/:entryId')
  deleteKnowledgeEntry(
    @Param('baseId') baseId: string,
    @Param('entryId') entryId: string,
  ) {
    const ok = this.knowledgeBase.deleteEntry(baseId, entryId);
    if (!ok) return { error: 'Entry not found' };
    return { message: 'Deleted' };
  }

  @Get('knowledge/settings')
  getKnowledgeSettings() {
    return this.knowledgeBase.getGlobalSettings();
  }

  @Post('knowledge/settings')
  updateKnowledgeSettings(@Body() body: any) {
    return this.knowledgeBase.updateGlobalSettings(body);
  }

  @Post('knowledge/reload')
  reloadKnowledge() {
    return this.knowledgeBase.reload();
  }

  @Get('knowledge/search')
  searchKnowledge(@Query('q') query: string) {
    if (!query) return { results: [] };
    return { results: this.knowledgeBase.search(query) };
  }

  /**
   * Web search API (for local models — SearXNG proxy)
   */
  @Get('search')
  async search(@Query('q') query: string) {
    if (!query) {
      return { results: [] };
    }

    try {
      const results = await this.searchService.search(query, { maxResults: 5 });
      return { results };
    } catch (error) {
      this.logger.error(`Search error: ${error.message}`);
      return { results: [] };
    }
  }

  /**
   * SayKnowbot Tool call API
   * Used when Tool execution is needed from the Electron app.
   * When AI returns tool_calls, SayKnowbot executes them locally.
   */
  @Post('chat/tools')
  async chatWithTools(
    @Body() dto: ChatRequestDto & { enableTools?: boolean },
    @Res() res: Response,
  ) {
    const startTime = Date.now();
    this.logger.log(`🔧 SayKnowbot Tool request: model=${dto.aiModel || 'pro'}`);

    try {
      // messages array is required
      if (!dto.messages || dto.messages.length === 0) {
        if (dto.message) {
          dto.messages = [{ role: 'user', content: dto.message }];
        } else {
          res.status(400).json({ error: 'messages array is required' });
          return;
        }
      }

      // Add Tool usage instructions to system prompt
      const systemPrompt = `${this.promptManager.getFeaturePrompt('tools')}
${dto.systemPrompt || ''}`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...dto.messages.filter(m => m.role !== 'system'),
      ];

      // Request Tool call via OpenRouter
      const result = await this.openRouterService.chat(
        messages,
        'upstage/solar-pro-3:free', // Model with Tool calling support
        SAYKNOWBOT_TOOLS,
      );

      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ Tool response: ${elapsed}ms, toolCalls=${result.toolCalls?.length || 0}`);

      // Return if there are Tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        res.json({
          content: result.content,
          toolCalls: result.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          })),
          model: result.modelUsed,
          tokensUsed: result.tokensUsed,
        });
        return;
      }

      // No Tool calls, return normal response
      res.json({
        content: result.content,
        toolCalls: null,
        model: result.modelUsed,
        tokensUsed: result.tokensUsed,
      });
    } catch (error) {
      this.logger.error('Tool chat error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * SayKnowbot Tool definitions query API
   */
  @Get('tools')
  getTools() {
    return {
      tools: SAYKNOWBOT_TOOLS,
      count: SAYKNOWBOT_TOOLS.length,
    };
  }

  /**
   * Chat API (streaming/non-streaming unified)
   */
  @Post('chat')
  async chat(
    @Body() dto: ChatRequestDto,
    @Res() res: Response,
  ) {
    const startTime = Date.now();
    const useMemory = dto.useMemory !== false && !!dto.userId && !!dto.sessionId;
    
    this.logger.log(`📨 Chat request: useMemory=${useMemory}, userId=${dto.userId}, sessionId=${dto.sessionId}`);

    // Auto-save user profile to memory if provided (info from Clerk)
    if (useMemory && dto.userProfile && dto.userId) {
      try {
        if (dto.userProfile.name) {
          await this.userMemory.updateProfile(dto.userId, { name: dto.userProfile.name });
          this.logger.log(`👤 Auto-saved user name from Clerk: ${dto.userProfile.name}`);
        }
        // Don't store email in memory for privacy reasons
      } catch (error) {
        this.logger.warn(`⚠️ Failed to save user profile: ${error.message}`);
      }
    }

    try {
      let messages: Array<{ role: string; content: string }>;
      let memoryContext: any = null;

      // Use messages array if present, otherwise error
      if (dto.messages && dto.messages.length > 0) {
        messages = dto.messages;
        this.logger.log(`📝 Using provided messages: ${messages.length}`);
        
        // Load additional context from Redis when memory system is active (parallel)
        if (useMemory) {
          const [userMemorySummary, sessionCtx, entitySummary] = await Promise.all([
            this.userMemory.getMemorySummary(dto.userId!),
            this.sessionContext.getContext(dto.sessionId!),
            this.entityStore.getEntitySummary(dto.userId!),  // Entity Store summary
          ]);
          
          // Load recent conversation history (max 6)
          if (sessionCtx?.recentMessages && sessionCtx.recentMessages.length > 0) {
            const historyMessages = sessionCtx.recentMessages.map(m => ({
              role: m.role,
              content: m.content,
            }));
            
            // Skip duplicate if current message matches last history message
            const lastHistoryContent = historyMessages[historyMessages.length - 1]?.content;
            const currentContent = messages[messages.length - 1]?.content;
            
            if (lastHistoryContent !== currentContent) {
              // Combine history + current messages
              messages = [...historyMessages, ...messages];
              this.logger.log(`📜 Loaded ${historyMessages.length} recent messages from Redis`);
            }
          }
          
          memoryContext = {
            userMemorySummary,
            sessionSummary: sessionCtx?.summary || null,  // Also pass summary
            topics: sessionCtx?.topics || [],
            keyPoints: sessionCtx?.keyPoints || [],
            entitySummary,  // Entity Store summary
          };
          
          if (userMemorySummary || sessionCtx?.summary || (sessionCtx?.topics && sessionCtx.topics.length > 0)) {
            this.logger.log(`🧠 Memory context loaded: user=${!!userMemorySummary}, session=${!!sessionCtx?.summary}, topics=${sessionCtx?.topics?.length || 0}`);
          }
        }
      } else if (dto.message) {
        // Single message (memory system - recommended approach)
        this.logger.log(`📝 Using single message with memory system`);
        this.logger.log(`🔑 Session ID: ${dto.sessionId}, User ID: ${dto.userId}`);
        
        // Load history + context from Redis when memory system is active (parallel)
        if (useMemory) {
          const [userMemorySummary, sessionCtx, relevantMemory, entitySummary] = await Promise.all([
            this.userMemory.getMemorySummary(dto.userId!),
            this.sessionContext.getContext(dto.sessionId!),
            this.semanticMemory.getRelevantContext(dto.userId!, dto.message),
            this.entityStore.getEntitySummary(dto.userId!),  // Entity Store summary
          ]);
          
          // Debug: detailed Redis lookup result log
          this.logger.log(`🔍 Redis lookup result - sessionCtx exists: ${!!sessionCtx}, messageCount: ${sessionCtx?.messageCount || 0}, recentMessages: ${sessionCtx?.recentMessages?.length || 0}`);
          
          if (relevantMemory) {
            this.logger.log(`🔍 Found relevant semantic memory`);
          }
          
          // Load recent conversation history (max 6) + current message
          if (sessionCtx?.recentMessages && sessionCtx.recentMessages.length > 0) {
            const historyMessages = sessionCtx.recentMessages.map(m => ({
              role: m.role,
              content: m.content,
            }));
            
            // Skip duplicate if current message matches last history message
            const lastHistoryContent = historyMessages[historyMessages.length - 1]?.content;
            
            if (lastHistoryContent !== dto.message) {
              // Combine history + current message
              messages = [...historyMessages, { role: 'user', content: dto.message }];
              this.logger.log(`📜 Loaded ${historyMessages.length} recent messages from Redis, total: ${messages.length}`);
            } else {
              // Duplicate, use only current message
              messages = [{ role: 'user', content: dto.message }];
            }
          } else {
            // No history, use only current message
            messages = [{ role: 'user', content: dto.message }];
            this.logger.log(`📝 No history found, using single message`);
          }
          
          memoryContext = {
            userMemorySummary,
            sessionSummary: sessionCtx?.summary || null,
            topics: sessionCtx?.topics || [],
            keyPoints: sessionCtx?.keyPoints || [],
            relevantMemory,  // Semantic search results
            entitySummary,   // Entity Store summary
          };
          
          if (userMemorySummary || sessionCtx?.summary || (sessionCtx?.topics && sessionCtx.topics.length > 0)) {
            this.logger.log(`🧠 Memory context loaded: user=${!!userMemorySummary}, session=${!!sessionCtx?.summary}, topics=${sessionCtx?.topics?.length || 0}`);
          }
        } else {
          // Memory system disabled, use single message only
          messages = [{ role: 'user', content: dto.message }];
        }
      } else {
        res.status(400).json({ error: 'Either message or messages array is required' });
        return;
      }

      const lastMessage = messages[messages.length - 1]?.content || '';

      // 1. Extract text from images/files via OCR if present
      let ocrContext = '';
      
      if (dto.files && dto.files.length > 0) {
        const ocrStart = Date.now();
        this.logger.log(`📄 Processing ${dto.files.length} files with OCR...`);
        const ocrResults = await Promise.all(
          dto.files.map(file => this.ocrService.processFile(file))
        );
        ocrContext = ocrResults.join('\n\n---\n\n');
        this.logger.log(`✅ OCR completed: ${ocrContext.length} chars (${Date.now() - ocrStart}ms)`);
      }

      // 2. Web search - only execute when enableSearch is explicitly true
      let searchContext = '';
      
      // Determine search/thinking mode from global learning (single call)
      let shouldSearch = dto.enableSearch === true;
      let enableThinking = dto.enableThinking ?? false;
      let brandingRules: string | null = null;
      
      // Determine features + branding rules in parallel
      if (useMemory) {
        const detectedLang = this.contextBuilder.detectLanguage(lastMessage);
        
        const [features, brandingResult] = await Promise.all([
          this.contextBuilder.shouldEnableFeatures(lastMessage),
          dto.sessionId 
            ? this.contextBuilder.getSmartBrandingRules(dto.sessionId, lastMessage, detectedLang)
            : Promise.resolve({ rules: null, isFirstMessage: false, isIdentityQuestion: false }),
        ]);
        
        if (!shouldSearch && features.enableSearch) {
          shouldSearch = true;
          this.logger.log(`🔍 Auto-enabled search based on learned patterns`);
        }
        if (!enableThinking && features.enableThinking) {
          enableThinking = true;
          this.logger.log(`🤔 Auto-enabled thinking based on learned patterns`);
        }
        brandingRules = brandingResult.rules;
      }
      
      if (shouldSearch && !ocrContext) {
        const searchStart = Date.now();
        this.logger.log(`🔍 Performing web search...`);
        const searchQuery = this.aiRouterService.generateSearchQuery(lastMessage);
        this.logger.log(`🔍 Search query: "${searchQuery}"`);
        const searchResults = await this.searchService.search(searchQuery);
        searchContext = this.formatSearchResults(searchResults);
        this.logger.log(`✅ Search completed: ${searchResults.length} results (${Date.now() - searchStart}ms)`);
      }

      // 2.5. Knowledge base search (sent as separate recommendations, not injected into system prompt)
      let knowledgeResults: import('../knowledge/knowledge-base.service').SearchResult[] = [];
      if (!ocrContext) {
        knowledgeResults = this.knowledgeBase.search(lastMessage, 3);
        if (knowledgeResults.length > 0) {
          this.logger.log(`📚 Found ${knowledgeResults.length} knowledge recommendations (will send separately)`);
        }
      }
      const knowledgeContext: string | null = null; // No longer injected into system prompt

      // 3. Combine context
      const buildStart = Date.now();
      
      const enhancedMessages = this.buildEnhancedMessages(
        messages,
        ocrContext,
        searchContext,
        dto.systemPrompt,
        enableThinking,
        dto.userContext,
        memoryContext,  // Pass memory context
        brandingRules,  // Branding rules (smart application)
        knowledgeContext,  // Knowledge base context
        dto.aiModel,  // Model-specific prompt selection
        dto.isNewSession,  // Whether this is the first conversation
      );
      this.logger.log(`📦 Messages built (${Date.now() - buildStart}ms), total messages: ${enhancedMessages.length}`);


      // stream: false means non-streaming response (with cascade fallback)
      if (dto.stream === false) {
        const llmStart = Date.now();
        this.logger.log(`🤖 Starting cascade call (model: ${dto.aiModel || 'pro'}, lang: ${dto.userLanguage || 'auto'}) at: ${new Date().toISOString()}`);
        
        // Start tracing span for AI call (Requirements 7.3)
        const span = this.tracer.startSpan({
          type: SpanType.AI_CALL,
          userId: dto.userId,
          sessionId: dto.sessionId,
          metadata: { 
            model: dto.aiModel || 'pro',
            userLanguage: dto.userLanguage,
            hasOCR: !!ocrContext,
            hasSearch: !!searchContext,
            enableThinking,
          },
        });
        
        try {
          const result = await this.aiRouterService.chatWithCascade(enhancedMessages, dto.aiModel, dto.userLanguage);
          this.logger.log(`✅ Completed (${Date.now() - llmStart}ms), model used: ${result.modelUsed}, fallback: ${result.fallbackUsed}`);
          
          // End span with success (Requirements 7.3)
          await this.tracer.endSpan(span.id, {
            success: true,
            modelUsed: result.modelUsed,
            tokensUsed: result.tokensUsed,
            latencyMs: Date.now() - llmStart,
            fallbackUsed: result.fallbackUsed,
            responseLength: result.content?.length,
          });
          
          // Update memory system - extract last user message from messages array
          if (useMemory) {
            const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
            if (lastUserMessage) {
              await this.updateMemoryAfterResponse(
                dto.userId!,
                dto.sessionId!,
                lastUserMessage,
                result.content,
                result.modelUsed,  // Save model used
              );
            }
          }
          
          // Filter model names from response
          const filteredContent = this.filterModelNamesFromChunk(result.content);
          
          const responseData: any = {
            content: filteredContent,
            hasOCR: !!ocrContext,
            hasSearch: !!searchContext,
            hasThinking: enableThinking,
            model: result.modelUsed,
            tokensUsed: result.tokensUsed,
            memoryUsed: useMemory,
          };
          
          // 📚 Include knowledge base recommendations in stream: false response as well
          if (knowledgeResults.length > 0) {
            responseData.knowledgeRecommendations = knowledgeResults.map(r => ({
              content: r.content,
              baseName: r.baseName,
              source: r.source,
              imageUrl: r.imageUrl,
              similarity: r.similarity,
              url: r.url,
              type: r.type,
            }));
            this.logger.log(`📚 Sent ${knowledgeResults.length} knowledge recommendations (non-stream)`);
          }
          
          this.logger.log(`📤 Total time: ${Date.now() - startTime}ms, tokens: ${result.tokensUsed}`);
          res.json(responseData);
          return;
        } catch (error) {
          // Record error in span (Requirements 7.3)
          await this.tracer.recordError(span.id, error, error.message === 'CASCADE_FALLBACK_NEEDED');
          
          if (error.message === 'CASCADE_FALLBACK_NEEDED') {
            this.logger.warn(`🔄 All local models failed, returning fallback signal`);
            res.status(503).json({ 
              error: 'CASCADE_FALLBACK_NEEDED',
              message: 'All local models busy, please use Vertex AI fallback'
            });
            return;
          }
          throw error;
        }
      }

      // 4. Set up streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // 5. Streaming response (with cascade fallback)
      const llmStreamStart = Date.now();
      const hasImages = dto.images && dto.images.length > 0;
      this.logger.log(`🤖 Starting stream cascade (model: ${dto.aiModel || 'pro'}, lang: ${dto.userLanguage || 'auto'}, images: ${hasImages ? dto.images!.length : 0}) at: ${new Date().toISOString()}`);
      
      // Start tracing span for streaming AI call (Requirements 7.3, 7.5)
      const streamSpan = this.tracer.startSpan({
        type: SpanType.AI_CALL,
        userId: dto.userId,
        sessionId: dto.sessionId,
        metadata: { 
          model: dto.aiModel || 'pro',
          userLanguage: dto.userLanguage,
          hasOCR: !!ocrContext,
          hasSearch: !!searchContext,
          hasImages,
          enableThinking,
          streaming: true,
        },
      });
      
      try {
        let stream: import('events').EventEmitter;
        let modelUsed: string;

        if (hasImages && dto.images) {
          // Route to vision model if images are present
          this.logger.log(`🖼️ Routing to vision model (${dto.images.length} images)`);
          const lastUserMsg = enhancedMessages.filter(m => m.role === 'user').pop();
          const images = dto.images;
          let visionSystemPrompt = this.promptManager.getFeaturePrompt('vision');
          if (!enableThinking) {
            visionSystemPrompt += ' /no_think\n\n' + this.promptManager.getFeaturePrompt('noThink');
          }
          const visionMessages: Array<{ role: string; content: any }> = [
            { role: 'system', content: visionSystemPrompt },
            {
              role: 'user',
              content: [
                ...images.map(img => ({
                  type: 'image_url' as const,
                  image_url: { url: `data:${img.mimeType};base64,${img.data}` },
                })),
                { type: 'text' as const, text: lastUserMsg?.content || 'Please analyze this image.' },
              ],
            },
          ];
          const visionResult = await this.aiRouterService.chatVisionStream(visionMessages);
          stream = visionResult.emitter;
          modelUsed = visionResult.modelUsed;
        } else {
          // Normal text cascade (uses thinking cascade if enableThinking)
          const cascadeResult = await this.aiRouterService.chatStreamWithCascade(
            enhancedMessages, dto.aiModel, dto.userLanguage, dto.userId, dto.sessionId, enableThinking,
          );
          stream = cascadeResult.emitter;
          modelUsed = cascadeResult.modelUsed;
        }

        this.logger.log(`✅ Stream created with ${modelUsed} (${Date.now() - llmStreamStart}ms)`);
        
        let fullResponse = '';
        let thinkingContent = '';  // Store thinking content separately
        let isInThinkingMode = false;  // Track if inside thinking tags
        let thinkingBuffer = '';  // Thinking buffer
        let streamEnded = false;  // Prevent duplicate processing
        let spanEnded = false;    // Prevent duplicate Span closure (Requirements 7.5)
        let hasNotifiedThinking = false;  // Whether thinking start was notified

      stream.on('data', (chunk: string) => {
        if (streamEnded) return;
        
        // Detect thinking tags and process
        let processedChunk = chunk;
        
        // Detect <think> or <thinking> start
        if (!isInThinkingMode && (chunk.includes('<think>') || chunk.includes('<thinking>'))) {
          isInThinkingMode = true;
          // Thinking start notification (once only)
          if (!hasNotifiedThinking) {
            hasNotifiedThinking = true;
            res.write(`data: ${JSON.stringify({ thinking: true, status: 'Thinking...' })}\n\n`);
          }
        }
        
        // In thinking mode
        if (isInThinkingMode) {
          thinkingBuffer += chunk;
          
          // Safety: force exit if thinking buffer is too large (over 5000 chars)
          if (thinkingBuffer.length > 5000 && !thinkingBuffer.includes('</think>') && !thinkingBuffer.includes('</thinking>')) {
            isInThinkingMode = false;
            this.logger.warn(`⚠️ Thinking buffer overflow (${thinkingBuffer.length} chars), forcing exit`);
            // Discard thinking content, remove tags from buffer and output
            const cleaned = thinkingBuffer.replace(/<think(?:ing)?>/gi, '').trim();
            if (cleaned) {
              const filteredChunk = this.filterModelNamesFromChunk(cleaned);
              fullResponse += filteredChunk;
              res.write(`data: ${JSON.stringify({ content: filteredChunk, thinkingDone: true })}\n\n`);
            }
            thinkingBuffer = '';
            return;
          }
          
          // Detect </think> or </thinking> end
          if (thinkingBuffer.includes('</think>') || thinkingBuffer.includes('</thinking>')) {
            isInThinkingMode = false;
            
            // Extract and summarize thinking content
            const thinkMatch = thinkingBuffer.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
            if (thinkMatch) {
              thinkingContent = thinkMatch[1].trim();
              // Send thinking summary (first 100 chars only)
              const thinkingSummary = this.summarizeThinking(thinkingContent);
              res.write(`data: ${JSON.stringify({ thinkingSummary, thinkingDone: true })}\n\n`);
            }
            
            // Extract content after thinking tags
            const afterThink = thinkingBuffer.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, '');
            if (afterThink.trim()) {
              const filteredChunk = this.filterModelNamesFromChunk(afterThink);
              fullResponse += filteredChunk;
              res.write(`data: ${JSON.stringify({ content: filteredChunk })}\n\n`);
            }
            thinkingBuffer = '';
          }
          return;  // Don't output normally in thinking mode
        }
        
        // Numbered analysis process detection (1. **Analyze... pattern)
        if (/^\d+\.\s+\*\*(?:Analyze|Check|Determine|Formulate|Draft|Refine|Final|Review)/i.test(chunk)) {
          if (!hasNotifiedThinking) {
            hasNotifiedThinking = true;
            res.write(`data: ${JSON.stringify({ thinking: true, status: 'Analyzing...' })}\n\n`);
          }
          thinkingContent += chunk;
          return;  // Don't output analysis process
        }
        
        // Normal response processing
        const filteredChunk = this.filterModelNamesFromChunk(processedChunk);
        fullResponse += filteredChunk;
        // Send in SSE format
        res.write(`data: ${JSON.stringify({ content: filteredChunk })}\n\n`);
      });

      stream.once('end', async () => {  // Changed on → once
        if (streamEnded) return;  // Prevent duplicate execution
        streamEnded = true;
        
        // Flush buffer if thinking mode is still active when stream ends
        if (isInThinkingMode && thinkingBuffer) {
          isInThinkingMode = false;
          const cleaned = thinkingBuffer.replace(/<think(?:ing)?>/gi, '').replace(/<\/think(?:ing)?>/gi, '').trim();
          if (cleaned) {
            const filteredChunk = this.filterModelNamesFromChunk(cleaned);
            fullResponse += filteredChunk;
            res.write(`data: ${JSON.stringify({ content: filteredChunk, thinkingDone: true })}\n\n`);
          }
          thinkingBuffer = '';
        }
        
        // Estimate token count (approx 2 chars per token for Korean, 4 for English)
        const estimatedTokens = Math.ceil(fullResponse.length / 2);
        
        // End span at stream completion (Requirements 7.5: single endSpan call at stream completion)
        if (!spanEnded) {
          spanEnded = true;
          await this.tracer.endSpan(streamSpan.id, {
            success: true,
            modelUsed,
            tokensUsed: estimatedTokens,
            latencyMs: Date.now() - llmStreamStart,
            fallbackUsed: false,
            responseLength: fullResponse.length,
          });
        }
        
        // Update memory system - extract last user message from messages array
        if (useMemory) {
          const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
          if (lastUserMessage) {
            await this.updateMemoryAfterResponse(
              dto.userId!,
              dto.sessionId!,
              lastUserMessage,
              fullResponse,
              modelUsed,  // Save model used
            );
          }
        }
        
        // Sign response
        const responseData: ChatResponseDto = {
          content: fullResponse,
          hasOCR: !!ocrContext,
          hasSearch: !!searchContext,
          hasThinking: enableThinking,
          model: modelUsed,
          tokensUsed: estimatedTokens,
          memoryUsed: useMemory,
        };
        
        const { signature, timestamp } = this.cryptoService.signResponse(
          JSON.stringify(responseData)
        );

        // Send final metadata
        const finalPayload: any = {
          done: true,
          meta: responseData,
          signature,
          timestamp,
        };

        // Send knowledge base recommendations as a separate field (separated from AI response)
        if (knowledgeResults.length > 0) {
          finalPayload.knowledgeRecommendations = knowledgeResults.map(r => ({
            content: r.content,
            baseName: r.baseName,
            source: r.source,
            imageUrl: r.imageUrl,
            similarity: r.similarity,
            url: r.url,
            type: r.type,
          }));
          this.logger.log(`📚 Sent ${knowledgeResults.length} knowledge recommendations separately`);
        }

        res.write(`data: ${JSON.stringify(finalPayload)}\n\n`);
        
        res.end();
        this.logger.log(`✅ Chat completed: ${fullResponse.length} chars, ~${estimatedTokens} tokens`);
      });

      stream.once('error', async (error: Error) => {  // Changed on → once
        if (streamEnded) return;
        streamEnded = true;
        
        // Record error in span (Requirements 7.3, 7.5)
        if (!spanEnded) {
          spanEnded = true;
          await this.tracer.recordError(streamSpan.id, error, false);
        }
        
        this.logger.error('Stream error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      });
      
      } catch (error) {
        // Record error in span for cascade fallback (Requirements 7.3)
        await this.tracer.recordError(streamSpan.id, error, error.message === 'CASCADE_FALLBACK_NEEDED');
        
        if (error.message === 'CASCADE_FALLBACK_NEEDED') {
          this.logger.warn(`🔄 All local models failed for streaming, returning fallback signal`);
          res.write(`data: ${JSON.stringify({ error: 'CASCADE_FALLBACK_NEEDED' })}\n\n`);
          res.end();
          return;
        }
        throw error;
      }

    } catch (error) {
      this.logger.error('Chat error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update memory system (after response)
   */
  private async updateMemoryAfterResponse(
    userId: string,
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    modelUsed?: string,
    messageCount?: number,
  ): Promise<void> {
    try {
      const { needsSummary, context } = await this.contextBuilder.updateAfterResponse(
        userId,
        sessionId,
        userMessage,
        assistantResponse,
        this.aiRouterService,  // Pass AI router (for conditional AI extraction)
      );

      // Save model used (for branding)
      if (modelUsed) {
        await this.contextBuilder.saveLastModelUsed(sessionId, modelUsed);
      }

      // Save to semantic memory (auto-extract important info)
      await this.semanticMemory.extractAndSaveFromConversation(
        userId,
        sessionId,
        userMessage,
        assistantResponse,
      );

      // Update Entity Store (smart extraction - rule-based + conditional AI)
      const isLocalModelAvailable = modelUsed === 'lite' || process.env.OLLAMA_AVAILABLE === 'true';
      const entities = await this.entityStore.smartExtract(
        userId,
        userMessage,
        assistantResponse,
        messageCount || context?.messageCount || 0,
        this.aiRouterService,
        isLocalModelAvailable,
      );
      
      if (entities.length > 0) {
        await this.entityStore.updateStore(userId, entities, userMessage);
        this.logger.log(`🏷️ Extracted ${entities.length} entities for user ${userId}`);
      }

      // Generate summary if needed (async)
      if (needsSummary) {
        this.generateAndSaveSummary(sessionId).catch(err => {
          this.logger.error(`Failed to generate summary: ${err.message}`);
        });
      }
    } catch (error) {
      this.logger.error(`Failed to update memory: ${error.message}`);
    }
  }

  /**
   * Generate and save summary (async)
   */
  private async generateAndSaveSummary(sessionId: string): Promise<void> {
    const summaryPrompt = await this.contextBuilder.generateSummaryPrompt(sessionId);
    if (!summaryPrompt) return;

    try {
      // Generate summary using AI call (flash model)
      const result = await this.aiRouterService.chatWithCascade(
        [{ role: 'user', content: summaryPrompt }],
        'flash',
      );
      
      await this.contextBuilder.saveSummary(sessionId, result.content);
      this.logger.log(`📝 Generated and saved summary for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to generate summary: ${error.message}`);
    }
  }

  /**
   * Get user memory API
   */
  @Get('memory/:userId')
  async getUserMemory(@Param('userId') userId: string) {
    const memory = await this.userMemory.getMemory(userId);
    if (!memory) {
      return { message: 'No memory found for this user' };
    }
    return memory;
  }

  /**
   * Delete user memory API (GDPR)
   */
  @Delete('memory/:userId')
  async deleteUserMemory(@Param('userId') userId: string) {
    await this.userMemory.deleteMemory(userId);
    return { message: 'Memory deleted successfully' };
  }

  /**
   * Get session context API
   */
  @Get('session/:sessionId')
  async getSessionContext(@Param('sessionId') sessionId: string) {
    const context = await this.sessionContext.getContext(sessionId);
    if (!context) {
      return { message: 'No context found for this session' };
    }
    return context;
  }

  /**
   * Delete session API
   */
  @Delete('session/:sessionId')
  async deleteSession(@Param('sessionId') sessionId: string) {
    await this.sessionContext.deleteSession(sessionId);
    return { message: 'Session deleted successfully' };
  }

  /**
   * Get global learning data API
   */
  @Get('learnings')
  async getLearnings() {
    const learnings = await this.globalLearning.getLearnings();
    return learnings || { message: 'No learnings found' };
  }

  /**
   * Chat API (non-streaming)
   */
  @Post('chat/sync')
  async chatSync(@Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    this.logger.log(`📨 Sync chat request`);
    const startTime = Date.now();

    // Start tracing span for sync AI call (Requirements 7.3)
    const span = this.tracer.startSpan({
      type: SpanType.AI_CALL,
      userId: dto.userId,
      sessionId: dto.sessionId,
      metadata: { 
        model: dto.aiModel || 'pro',
        endpoint: 'chat/sync',
      },
    });

    try {
      // Error if messages array is not present
      if (!dto.messages || dto.messages.length === 0) {
        throw new Error('messages array is required for sync chat');
      }
      
      const lastMessage = dto.messages[dto.messages.length - 1]?.content || '';
      
      // 1. Extract text from images/files via OCR if present
      let ocrContext = '';
      
      if (dto.files && dto.files.length > 0) {
        this.logger.log(`📄 Processing ${dto.files.length} files with OCR...`);
        const ocrResults = await Promise.all(
          dto.files.map(file => this.ocrService.processFile(file))
        );
        ocrContext = ocrResults.join('\n\n---\n\n');
      }

      // 2. Search handling - only execute when enableSearch is explicitly true
      let searchContext = '';
      
      if (dto.enableSearch === true && !ocrContext) {
        const searchQuery = this.aiRouterService.generateSearchQuery(lastMessage);
        const searchResults = await this.searchService.search(searchQuery);
        searchContext = this.formatSearchResults(searchResults);
      }

      // 3. Build messages
      const enhancedMessages = this.buildEnhancedMessages(
        dto.messages,
        ocrContext,
        searchContext,
        dto.systemPrompt,
        dto.enableThinking ?? false,
        dto.userContext,
        undefined,  // memoryContext
        undefined,  // brandingRules
        undefined,  // knowledgeContext
        dto.aiModel,  // Model-specific prompt selection
        dto.isNewSession,  // Whether this is the first conversation
      );

      // 4. LLM response (with cascade fallback)
      const result = await this.aiRouterService.chatWithCascade(enhancedMessages, dto.aiModel);

      // End span with success (Requirements 7.3)
      await this.tracer.endSpan(span.id, {
        success: true,
        modelUsed: result.modelUsed,
        tokensUsed: result.tokensUsed,
        latencyMs: Date.now() - startTime,
        fallbackUsed: result.fallbackUsed,
        responseLength: result.content?.length,
      });

      return {
        content: result.content,
        hasOCR: !!ocrContext,
        hasSearch: !!searchContext,
        hasThinking: dto.enableThinking ?? false,
        model: result.modelUsed,
        tokensUsed: result.tokensUsed,
      };
    } catch (error) {
      // Record error in span (Requirements 7.3)
      await this.tracer.recordError(span.id, error);
      
      this.logger.error('Sync chat error:', error);
      throw error;
    }
  }

  /**
   * File upload + chat
   */
  @Post('chat/with-files')
  @UseInterceptors(FilesInterceptor('files', 10))
  async chatWithFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('data') dataStr: string,
    @Res() res: Response,
  ) {
    const dto: ChatRequestDto = JSON.parse(dataStr);
    
    // Add files as base64 to dto
    if (files && files.length > 0) {
      dto.files = files.map(file => ({
        name: file.originalname,
        type: file.mimetype,
        data: file.buffer.toString('base64'),
      }));
    }

    return this.chat(dto, res);
  }

  private buildEnhancedMessages(
    messages: Array<{ role: string; content: string }>,
    ocrContext: string,
    searchContext: string,
    systemPrompt?: string,
    enableThinking: boolean = false,
    userContext?: { time?: any; location?: any },
    memoryContext?: { 
      userMemorySummary?: string | null; 
      sessionSummary?: string | null; 
      topics?: string[]; 
      keyPoints?: string[];
      relevantMemory?: string | null;
      entitySummary?: string | null;  // Entity Store summary
    },
    brandingRules?: string | null,
    knowledgeContext?: string | null,
    aiModel?: string,
    isNewSession?: boolean,
  ) {
    const enhancedMessages = [...messages];

    // Use search-specific prompt when search results are present (ignore persona/system prompt)
    let systemContent: string;
    
    if (searchContext) {
      // Search mode: branding rules + search-specific prompt
      const parts: string[] = [];
      
      // Branding rules (also applied for identity questions)
      if (brandingRules) {
        parts.push(brandingRules);
        this.logger.log(`🏷️ Applied branding rules in search mode`);
      }
      
      parts.push(this.promptManager.getFeaturePrompt('search'));
      systemContent = parts.join('\n\n');
      
      // Add user context (time, location)
      if (userContext) {
        this.logger.log(`📍 User context received: ${JSON.stringify(userContext)}`);
        const contextParts: string[] = [];
        if (userContext.time) {
          contextParts.push(`Current time: ${userContext.time.localTime || userContext.time.date} (${userContext.time.dayOfWeek || ''})`);
        }
        if (userContext.location?.city) {
          contextParts.push(`Location: ${userContext.location.city}`);
        }
        if (contextParts.length > 0) {
          systemContent += `\n\n[User Info]\n${contextParts.join(', ')}`;
        }
      }
      
      // Add search results
      systemContent += `\n\n[Search Results]\n${searchContext}\n\nAnswer based on the search results above.`;
      
      this.logger.log(`🔍 Search mode: using search-focused prompt`);
    } else {
      // Normal mode: system prompt/persona first, branding rules as supplementary
      const parts: string[] = [];
      
      // 1. System prompt/persona (highest priority)
      const modelKey = (aiModel === 'flash' || aiModel === 'lite') ? aiModel : 'pro';
      const modelPrompt = this.promptManager.getModelPrompt(modelKey as 'pro' | 'flash' | 'lite');
      if (systemPrompt) {
        // Always include DB prompt (admin-configured)
        parts.push(systemPrompt);
        // Also include AI server model prompt on first conversation only
        if (isNewSession && modelPrompt && modelPrompt !== systemPrompt) {
          parts.push(modelPrompt);
        }
      } else {
        parts.push(modelPrompt);
      }
      
      // 2. Branding rules (only when no persona is set, or as supplementary reference)
      if (brandingRules && !systemPrompt) {
        parts.push(brandingRules);
        this.logger.log(`🏷️ Applied branding rules (no persona set)`);
      }
      
      // 3. Always add model name ban rule (applied even in persona mode)
      parts.push(this.promptManager.getRule('modelNameBan'));
      
      systemContent = parts.join('\n\n');
      
      // Inject memory context (for personalized responses)
      if (memoryContext) {
        // User memory (name, occupation, interests, etc.)
        if (memoryContext.userMemorySummary) {
          systemContent += `\n\n${memoryContext.userMemorySummary}`;
          this.logger.log(`🧠 Injected user memory into prompt`);
        }
        
        // Session summary (previous conversation context)
        if (memoryContext.sessionSummary) {
          systemContent += `\n\n[Previous Conversation Summary]\n${memoryContext.sessionSummary}`;
          this.logger.log(`📜 Injected session summary into prompt`);
        }
        
        // Conversation topics
        if (memoryContext.topics && memoryContext.topics.length > 0) {
          systemContent += `\n\n[Current conversation topics: ${memoryContext.topics.slice(0, 5).join(', ')}]`;
        }
        
        // Key points (important info extracted from conversation)
        if (memoryContext.keyPoints && memoryContext.keyPoints.length > 0) {
          systemContent += `\n\n[Important info mentioned in conversation]\n- ${memoryContext.keyPoints.slice(-10).join('\n- ')}`;
          this.logger.log(`🔑 Injected ${memoryContext.keyPoints.length} key points into prompt`);
        }
        
        // Semantic search results (relevant memories)
        if (memoryContext.relevantMemory) {
          systemContent += `\n\n${memoryContext.relevantMemory}`;
          this.logger.log(`🔍 Injected relevant semantic memory into prompt`);
        }
        
        // Entity Store summary (interests, technologies, places, concepts, etc.)
        if (memoryContext.entitySummary) {
          systemContent += `\n\n${memoryContext.entitySummary}`;
          this.logger.log(`🏷️ Injected entity summary into prompt`);
        }
      }
      
      // Inject knowledge base context
      if (knowledgeContext) {
        systemContent += `\n\n${knowledgeContext}`;
        this.logger.log(`📚 Injected knowledge base context into prompt`);
      }
      
      // Add user context (time, location)
      if (userContext) {
        this.logger.log(`📍 User context received: ${JSON.stringify(userContext)}`);
        const contextParts: string[] = [];
        if (userContext.time) {
          contextParts.push(`Current time: ${userContext.time.localTime || userContext.time.date} (${userContext.time.dayOfWeek || ''})`);
          if (userContext.time.timezone) {
            contextParts.push(`Timezone: ${userContext.time.timezone}`);
          }
        }
        if (userContext.location?.city) {
          contextParts.push(`Location: ${userContext.location.city}${userContext.location.country ? ', ' + userContext.location.country : ''}`);
        }
        if (contextParts.length > 0) {
          systemContent += `\n\n[User Context]\n${contextParts.join('\n')}`;
        }
      }

      if (ocrContext) {
        systemContent += `\n\n[Document/Image Content]\n${ocrContext}`;
      }
    }
    
    // Qwen3 thinking mode setting - add at the very end
    if (!enableThinking) {
      systemContent += ' /no_think';
      systemContent += '\n\n' + this.promptManager.getFeaturePrompt('noThink');
    }

    // Replace if system message already exists, otherwise prepend
    const systemIndex = enhancedMessages.findIndex(m => m.role === 'system');
    if (systemIndex >= 0) {
      enhancedMessages[systemIndex].content = systemContent;
    } else {
      enhancedMessages.unshift({ role: 'system', content: systemContent });
    }
    
    // Debug: log final system prompt
    this.logger.log(`📝 Final system prompt length: ${systemContent.length} chars`);
    this.logger.log(`📝 System prompt preview: ${systemContent.substring(0, 500)}...`);

    return enhancedMessages;
  }

  private formatSearchResults(results: Array<{ title: string; url: string; snippet: string }>): string {
    return results
      .slice(0, 5) // Increased to 5
      .map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet.substring(0, 200)}`)
      .join('\n');
  }

  /**
   * Filter model names from streaming chunks.
   * Prevents model names from being output in real-time.
   */
  private filterModelNamesFromChunk(chunk: string): string {
    // Model name patterns (case insensitive)
    const modelPatterns = [
      /\bSolar\s*(Pro|Mini|Open100B)?\b/gi,
      /\bGPT[-\s]?[34](\.[05])?\b/gi,
      /\bGemini\s*(Pro|Flash|Ultra)?\b/gi,
      /\bClaude\s*[23]?(\.[05])?\b/gi,
      /\bQwen[23]?\b/gi,
      /\bGLM[-\s]?[45](\.[57])?\b/gi,
      /\bLlama\s*[234]?\b/gi,
      /\bStep\s*[23](\.[05])?\s*(Flash)?\b/gi,
      /\bDeepSeek\b/gi,
      /\bMistral\b/gi,
      /\bMixtral\b/gi,
    ];

    let filtered = chunk;
    for (const pattern of modelPatterns) {
      filtered = filtered.replace(pattern, 'SayKnow AI');
    }
    return filtered;
  }

  /**
   * Filter Thinking/Chain-of-Thought patterns (for full response).
   * Prevents AI from exposing its thinking process.
   */
  private filterThinkingFromResponse(content: string): string {
    let filtered = content;
    
    // 1. Remove <think>...</think> tags (e.g., Qwen3)
    filtered = filtered.replace(/<think>[\s\S]*?<\/think>/gi, '');
    
    // 2. Remove <thinking>...</thinking> tags
    filtered = filtered.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    
    // 3. Remove analysis process like **Analyze**, **Check**, **Draft**, **Refine**
    // Numbered analysis step pattern: "1. **Analyze..." or "1.  **Analyze..."
    filtered = filtered.replace(/^\d+\.\s+\*\*(?:Analyze|Check|Determine|Formulate|Draft|Refine|Final|Review|Identify|Strategy|Polish|Result|Selected)[\s\S]*?(?=^\d+\.\s+\*\*|\n\n[^0-9*]|$)/gim, '');
    
    // 4. Remove internal monologue patterns: "(Internal Monologue)" or "(See the actual output below)"
    filtered = filtered.replace(/\((?:Internal Monologue|See the actual output below|Drafting|Better|Closer to|A bit too)[^)]*\)/gi, '');
    
    // 5. Remove Draft 1, Draft 2, Draft 3 patterns
    filtered = filtered.replace(/\*?Draft\s*\d+[^:]*:\*?\s*[^\n]+/gi, '');
    
    // 6. Remove *Selected Response:* pattern
    filtered = filtered.replace(/\*Selected Response:\*/gi, '');
    
    // 7. Clean up consecutive blank lines (3 or more → 2)
    filtered = filtered.replace(/\n{3,}/g, '\n\n');
    
    // 8. Trim leading/trailing whitespace
    filtered = filtered.trim();
    
    return filtered;
  }

  /**
   * Summarize thinking content (for UI display).
   * Condenses long thinking content into a short summary.
   */
  private summarizeThinking(thinking: string): string {
    // Extract main keywords
    const keywords: string[] = [];
    
    // Detect analysis steps
    if (/analyze|analysis/i.test(thinking)) keywords.push('Analysis');
    if (/check|review/i.test(thinking)) keywords.push('Review');
    if (/draft|drafting/i.test(thinking)) keywords.push('Drafting');
    if (/refine|refining/i.test(thinking)) keywords.push('Refining');
    if (/constraint|rule|rules/i.test(thinking)) keywords.push('Rule check');
    if (/persona|tone/i.test(thinking)) keywords.push('Tone adjustment');
    
    if (keywords.length > 0) {
      return `${keywords.slice(0, 3).join(' → ')} done`;
    }
    
    // Default summary
    const lines = thinking.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      return `${lines.length}-step analysis done`;
    }
    
    return 'Analysis done';
  }
}
