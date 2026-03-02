import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { ZaiService } from './zai.service';
import { CloudflareService } from './cloudflare.service';
import { OpenRouterService, OPENROUTER_MODELS, OPENROUTER_VISION_MODELS } from './openrouter.service';
import { UpstageService } from './upstage.service';
import { NvidiaService, NVIDIA_MODELS } from './nvidia.service';
import { VeniceService, VENICE_MODELS } from './venice.service';
import { GrokService, GROK_MODELS } from './grok.service';

interface ChatMessage {
  role: string;
  content: string;
}

// Cascade result type
interface CascadeResult {
  content: string;
  tokensUsed: number;
  modelUsed: string;
  fallbackUsed: boolean;
}

// Cascade model item
export interface CascadeItem {
  type: string;
  model: string;
  name: string;
}

// Cascade config file structure
export interface CascadeConfig {
  pro: CascadeItem[];
  flash: CascadeItem[];
  thinking: CascadeItem[];
}

@Injectable()
export class AIRouterService implements OnModuleInit {
  private readonly logger = new Logger(AIRouterService.name);
  
  private defaultModel = 'flash';
  private useZai: boolean = true;
  private useCloudflare: boolean = true;
  private useOpenRouter: boolean = true;
  private useUpstage: boolean = true;
  private useNvidia: boolean = true;
  private useVenice: boolean = true;
  private useGrok: boolean = true;

  private cascadeConfig: CascadeConfig | null = null;
  private readonly cascadePath: string;

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => ZaiService)) private readonly zaiService: ZaiService,
    @Inject(forwardRef(() => CloudflareService)) private readonly cloudflareService: CloudflareService,
    @Inject(forwardRef(() => OpenRouterService)) private readonly openRouterService: OpenRouterService,
    @Inject(forwardRef(() => UpstageService)) private readonly upstageService: UpstageService,
    @Inject(forwardRef(() => NvidiaService)) private readonly nvidiaService: NvidiaService,
    @Inject(forwardRef(() => VeniceService)) private readonly veniceService: VeniceService,
    @Inject(forwardRef(() => GrokService)) private readonly grokService: GrokService,
  ) {
    this.useZai = this.configService.get('USE_ZAI', 'true') === 'true';
    this.useCloudflare = this.configService.get('USE_CLOUDFLARE', 'true') === 'true';
    this.useOpenRouter = this.configService.get('USE_OPENROUTER', 'true') === 'true';
    this.useUpstage = this.configService.get('USE_UPSTAGE', 'true') === 'true';
    this.useNvidia = this.configService.get('USE_NVIDIA', 'true') === 'true';
    this.useVenice = this.configService.get('USE_VENICE', 'false') === 'true';
    this.useGrok = this.configService.get('USE_GROK', 'false') === 'true';
    
    this.logger.log(`🤖 AI Router initialized with new cascade structure`);
    this.logger.log(`   - OpenRouter: ${this.useOpenRouter ? '✅' : '❌'}`);
    this.logger.log(`   - Grok (xAI): ${this.useGrok ? '✅' : '❌'}`);
    this.logger.log(`   - Venice AI (uncensored fallback): ${this.useVenice ? '✅' : '❌'}`);
    this.logger.log(`   - Upstage (Korean/Japanese): ${this.useUpstage ? '✅' : '❌'}`);
    this.logger.log(`   - NVIDIA NIM: ${this.useNvidia ? '✅' : '❌'}`);
    this.logger.log(`   - Z.AI: ${this.useZai ? '✅' : '❌'}`);
    this.logger.log(`   - Cloudflare: ${this.useCloudflare ? '✅' : '❌'}`);
    this.cascadePath = path.join(process.cwd(), 'data', 'cascade.json');
  }

  async onModuleInit() {
    this.loadCascadeConfig();
    this.logger.log(`📋 SayKnow AI Cascade Order:`);
    this.logger.log(`   Pro: ${this.getProCascade().map(m => m.name).join(' → ')}`);
    this.logger.log(`   Flash: ${this.getFlashCascade().map(m => m.name).join(' → ')}`);
  }

  // === Cascade config file management ===

  private loadCascadeConfig() {
    try {
      if (fs.existsSync(this.cascadePath)) {
        const raw = fs.readFileSync(this.cascadePath, 'utf-8');
        this.cascadeConfig = JSON.parse(raw);
        this.logger.log(`✅ Cascade config loaded from ${this.cascadePath}`);
      } else {
        this.cascadeConfig = null;
        this.logger.log(`📝 No cascade.json found, using hardcoded defaults`);
      }
    } catch (error) {
      this.logger.warn(`⚠️ Failed to load cascade.json: ${error.message}`);
      this.cascadeConfig = null;
    }
  }

  private saveCascadeConfig(config: CascadeConfig) {
    try {
      const dir = path.dirname(this.cascadePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.cascadePath, JSON.stringify(config, null, 2), 'utf-8');
      this.cascadeConfig = config;
      this.logger.log(`📝 Cascade config saved`);
    } catch (error) {
      this.logger.error(`❌ Failed to save cascade.json: ${error.message}`);
    }
  }

  /** Returns the catalog of all available models */
  getModelCatalog() {
    const catalog: Array<{ type: string; model: string; name: string; free: boolean }> = [];

    // OpenRouter models
    for (const [key, model] of Object.entries(OPENROUTER_MODELS)) {
      const isFree = (model as string).includes(':free');
      catalog.push({ type: 'openrouter', model: model as string, name: key, free: isFree });
    }
    // Grok models
    for (const [key, model] of Object.entries(GROK_MODELS)) {
      catalog.push({ type: 'grok', model: model as string, name: key, free: false });
    }
    // Venice models
    for (const [key, model] of Object.entries(VENICE_MODELS)) {
      catalog.push({ type: 'venice', model: model as string, name: key, free: false });
    }

    return catalog;
  }

  /** Update cascade */
  updateCascade(role: 'pro' | 'flash' | 'thinking', items: CascadeItem[]) {
    const current = this.cascadeConfig || {
      pro: this.getDefaultProCascade(),
      flash: this.getDefaultFlashCascade(),
      thinking: this.getDefaultThinkingCascade(),
    };
    current[role] = items;
    this.saveCascadeConfig(current);
    return current;
  }

  /** Update entire cascade config */
  updateAllCascades(config: CascadeConfig) {
    this.saveCascadeConfig(config);
    return config;
  }

  /** Reload cascade config */
  reloadCascade() {
    this.loadCascadeConfig();
    return this.getModels();
  }

  /**
   * Chat with cascade fallback
   * 
   * Pro (Korean/Japanese): Upstage Solar Pro → Solar Pro 3 (OR) → Step 3.5 Flash → Qwen3 Next 80B → Z.AI → Vertex AI
   * Pro (other):           Step 3.5 Flash → Qwen3 Next 80B → Z.AI GLM-4.7 → Vertex AI
   * Flash:                 Step 3.5 Flash → Cloudflare Llama 3.1 70B → Qwen3 Next 80B → Vertex AI
   * 
   * Note: Span tracing is handled in ai.controller.ts (to avoid duplication)
   */
  async chatWithCascade(
    messages: ChatMessage[], 
    aiModel?: string, 
    userLanguage?: string,
    userId?: string,
    sessionId?: string,
  ): Promise<CascadeResult> {
    const requestedModel = aiModel || this.defaultModel;
    const lastMessage = messages[messages.length - 1]?.content || '';
    
    // Korean/Japanese detection (via userLanguage or message content)
    const isKoreanOrJapanese = userLanguage === 'ko' || userLanguage === 'ja' ||
                               (this.useUpstage && this.upstageService.isReady() && 
                                this.upstageService.isKoreanOrJapanese(lastMessage)) ||
                               (this.useOpenRouter && this.openRouterService.isReady() && 
                                this.openRouterService.detectKorean(lastMessage));
    
    this.logger.log(`🔄 Starting cascade: model=${requestedModel}, korean/japanese=${isKoreanOrJapanese}`);
    
    // Pro model cascade
    if (requestedModel === 'pro') {
      return this.cascadePro(messages, isKoreanOrJapanese);
    } else {
      // Flash model cascade
      return this.cascadeFlash(messages);
    }
  }

  /**
   * Pro model cascade (SayKnow AI)
   * Dolphin Venice (OR free) → Hermes 405B (OR free) → Grok 4.1 Fast (OR paid) → Llama 70B (OR free) → Gemma 27B (OR free) → Grok xAI direct → Venice (paid)
   */
  private async cascadePro(messages: ChatMessage[], isKoreanOrJapanese: boolean): Promise<CascadeResult> {
    const cascade = this.getProCascade();

    for (const item of cascade) {
      try {
        const result = await this.tryModel(messages, item.type, item.model, item.name);
        if (result) return result;
      } catch (error) {
        this.logger.warn(`⚠️ ${item.name} failed: ${error.message}`);
        continue;
      }
    }

    this.logger.warn(`🔄 All Pro models failed`);
    throw new Error('ALL_MODELS_FAILED');
  }

  /**
   * Flash model cascade
   * Step 3.5 Flash → Cloudflare Llama 3.1 70B → Qwen3 Next 80B → Vertex AI
   */
  private async cascadeFlash(messages: ChatMessage[]): Promise<CascadeResult> {
    const cascade = this.getFlashCascade();

    for (const item of cascade) {
      try {
        const result = await this.tryModel(messages, item.type, item.model, item.name);
        if (result) return result;
      } catch (error) {
        this.logger.warn(`⚠️ ${item.name} failed: ${error.message}`);
        continue;
      }
    }

    this.logger.warn(`🔄 All Flash models failed, need Vertex AI fallback`);
    throw new Error('CASCADE_FALLBACK_NEEDED');
  }

  getProCascade() {
    if (this.cascadeConfig?.pro?.length) return this.cascadeConfig.pro;
    return this.getDefaultProCascade();
  }

  private getDefaultProCascade() {
    return [
      // 1st: OpenRouter free uncensored (Venice provider)
      { type: 'openrouter', model: OPENROUTER_MODELS.DOLPHIN_VENICE, name: 'Dolphin Venice Edition' },
      { type: 'openrouter', model: OPENROUTER_MODELS.HERMES_405B, name: 'Hermes 3 405B' },
      // 2nd: OpenRouter paid (Grok)
      { type: 'openrouter', model: OPENROUTER_MODELS.GROK_41_FAST, name: 'Grok 4.1 Fast (OR)' },
      // 3rd: OpenRouter free (other providers — not Venice)
      { type: 'openrouter', model: OPENROUTER_MODELS.LLAMA_33_70B, name: 'Llama 3.3 70B' },
      { type: 'openrouter', model: OPENROUTER_MODELS.GEMMA_3_27B, name: 'Gemma 3 27B' },
      // 4th: xAI direct API
      { type: 'grok', model: GROK_MODELS.GROK_41_FAST, name: 'Grok (xAI direct)' },
      // 5th: Venice paid
      { type: 'venice', model: VENICE_MODELS.UNCENSORED, name: 'Venice Uncensored (paid)' },
    ];
  }

  getFlashCascade() {
    if (this.cascadeConfig?.flash?.length) return this.cascadeConfig.flash;
    return this.getDefaultFlashCascade();
  }

  private getDefaultFlashCascade() {
    return [
      { type: 'openrouter', model: OPENROUTER_MODELS.STEP_35_FLASH, name: 'Step 3.5 Flash' },
      { type: 'cloudflare', model: 'llama-3.1-70b', name: 'Cloudflare Llama 3.1 70B' },
      { type: 'openrouter', model: OPENROUTER_MODELS.QWEN3_NEXT_80B, name: 'Qwen3 Next 80B' },
    ];
  }

  getModels() {
    return {
      pro: this.getProCascade(),
      flash: this.getFlashCascade(),
      thinking: this.getThinkingCascade(),
      catalog: this.getModelCatalog(),
    };
  }

  /**
   * Try a single model
   */
  private async tryModel(
    messages: ChatMessage[], 
    type: string, 
    model: string, 
    name: string
  ): Promise<CascadeResult | null> {
    const startTime = Date.now();
    
    if (type === 'upstage') {
      if (!this.useUpstage || !this.upstageService.isReady()) {
        this.logger.warn(`⚠️ Upstage not available, skipping ${name}`);
        return null;
      }
      
      this.logger.log(`🇰🇷 Trying ${name} (Upstage - Korean/Japanese specialized)`);
      const result = await this.upstageService.chat(messages);
      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ ${name} responded in ${elapsed}ms`);
      return result;
    }
    
    if (type === 'nvidia') {
      if (!this.useNvidia || !this.nvidiaService.isReady()) {
        this.logger.warn(`⚠️ NVIDIA NIM not available, skipping ${name}`);
        return null;
      }
      
      this.logger.log(`🟢 Trying ${name} (NVIDIA NIM)`);
      const result = await this.nvidiaService.chat(messages, model);
      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ ${name} responded in ${elapsed}ms`);
      return result;
    }
    
    if (type === 'openrouter') {
      if (!this.useOpenRouter || !this.openRouterService.isReady()) {
        this.logger.warn(`⚠️ OpenRouter not available, skipping ${name}`);
        return null;
      }
      
      this.logger.log(`🌐 Trying ${name} (OpenRouter)`);
      const result = await this.openRouterService.chat(messages, model);
      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ ${name} responded in ${elapsed}ms`);
      return result;
    }
    
    if (type === 'zai') {
      if (!this.useZai || !this.zaiService.isReady()) {
        this.logger.warn(`⚠️ Z.AI not available, skipping ${name}`);
        return null;
      }
      
      this.logger.log(`🤖 Trying ${name} (Z.AI)`);
      const result = await this.zaiService.chat(messages, model);
      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ ${name} responded in ${elapsed}ms`);
      return result;
    }
    
    if (type === 'cloudflare') {
      if (!this.useCloudflare || !this.cloudflareService.isReady()) {
        this.logger.warn(`⚠️ Cloudflare not available, skipping ${name}`);
        return null;
      }
      
      this.logger.log(`☁️ Trying ${name} (Cloudflare)`);
      const result = await this.cloudflareService.chat(messages, true);
      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ ${name} responded in ${elapsed}ms`);
      return result;
    }
    
    if (type === 'venice') {
      if (!this.useVenice || !this.veniceService.isReady()) {
        this.logger.warn(`⚠️ Venice AI not available, skipping ${name}`);
        return null;
      }
      
      this.logger.log(`🎭 Trying ${name} (Venice AI)`);
      const result = await this.veniceService.chat(messages, model);
      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ ${name} responded in ${elapsed}ms`);
      return result;
    }
    
    if (type === 'grok') {
      if (!this.useGrok || !this.grokService.isReady()) {
        this.logger.warn(`⚠️ Grok not available, skipping ${name}`);
        return null;
      }
      
      this.logger.log(`🤖 Trying ${name} (xAI)`);
      const result = await this.grokService.chat(messages, model);
      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ ${name} responded in ${elapsed}ms`);
      return result;
    }
    
    return null;
  }

  /**
   * Streaming chat (with cascade fallback)
   * 
   * Requirements: 7.3, 7.5
   * - 7.3: TracerService is injected into AI_Router for automatic tracing
   * - 7.5: During streaming, the Span is closed at full response completion, not per chunk
   */
  async chatStreamWithCascade(
    messages: ChatMessage[], 
    aiModel?: string, 
    userLanguage?: string,
    userId?: string,
    sessionId?: string,
    enableThinking?: boolean,
  ): Promise<{
    emitter: EventEmitter;
    modelUsed: string;
  }> {
    const requestedModel = aiModel || this.defaultModel;
    const lastMessage = messages[messages.length - 1]?.content || '';
    
    const isKoreanOrJapanese = userLanguage === 'ko' || userLanguage === 'ja' ||
                               (this.useUpstage && this.upstageService.isReady() && 
                                this.upstageService.isKoreanOrJapanese(lastMessage)) ||
                               (this.useOpenRouter && this.openRouterService.isReady() && 
                                this.openRouterService.detectKorean(lastMessage));
    
    this.logger.log(`🔄 Starting stream cascade: model=${requestedModel}, korean/japanese=${isKoreanOrJapanese}, thinking=${!!enableThinking}`);
    
    // Use streaming with auto-fallback (with tracing)
    return this.chatStreamWithAutoFallback(messages, aiModel, userLanguage, userId, sessionId, enableThinking);
  }


  /**
   * Try streaming a single model (wrapper for fallback on error)
   */
  private async tryStreamModel(
    messages: ChatMessage[], 
    type: string, 
    model: string, 
    name: string
  ): Promise<{ emitter: EventEmitter; modelUsed: string } | null> {
    if (type === 'upstage') {
      if (!this.useUpstage || !this.upstageService.isReady()) {
        return null;
      }
      
      this.logger.log(`🇰🇷 Trying ${name} stream (Upstage - Korean/Japanese specialized)`);
      return this.upstageService.chatStream(messages);
    }
    
    if (type === 'nvidia') {
      if (!this.useNvidia || !this.nvidiaService.isReady()) {
        return null;
      }
      
      this.logger.log(`🟢 Trying ${name} stream (NVIDIA NIM)`);
      return this.nvidiaService.chatStream(messages, model);
    }
    
    if (type === 'openrouter') {
      if (!this.useOpenRouter || !this.openRouterService.isReady()) {
        return null;
      }
      
      this.logger.log(`🌐 Trying ${name} stream (OpenRouter)`);
      return this.openRouterService.chatStream(messages, model);
    }
    
    if (type === 'zai') {
      if (!this.useZai || !this.zaiService.isReady()) {
        return null;
      }
      
      this.logger.log(`🤖 Trying ${name} stream (Z.AI)`);
      return this.zaiService.chatStream(messages, model);
    }
    
    if (type === 'cloudflare') {
      if (!this.useCloudflare || !this.cloudflareService.isReady()) {
        return null;
      }
      
      this.logger.log(`☁️ Trying ${name} stream (Cloudflare)`);
      return this.cloudflareService.chatStream(messages, true);
    }
    
    if (type === 'venice') {
      if (!this.useVenice || !this.veniceService.isReady()) {
        return null;
      }
      
      this.logger.log(`🎭 Trying ${name} stream (Venice AI)`);
      return this.veniceService.chatStream(messages, model);
    }
    
    if (type === 'grok') {
      if (!this.useGrok || !this.grokService.isReady()) {
        return null;
      }
      
      this.logger.log(`🤖 Trying ${name} stream (xAI)`);
      return this.grokService.chatStream(messages, model);
    }
    
    return null;
  }

  /**
   * Streaming with auto-fallback (falls back to next model on stream error)
   * 
   * Note: Span tracing is handled in ai.controller.ts (to avoid duplication)
   */
  async chatStreamWithAutoFallback(
    messages: ChatMessage[], 
    aiModel?: string, 
    userLanguage?: string,
    userId?: string,
    sessionId?: string,
    enableThinking?: boolean,
  ): Promise<{ emitter: EventEmitter; modelUsed: string }> {
    const requestedModel = aiModel || this.defaultModel;
    const lastMessage = messages[messages.length - 1]?.content || '';
    
    const isKoreanOrJapanese = userLanguage === 'ko' || userLanguage === 'ja' ||
                               (this.useUpstage && this.upstageService.isReady() && 
                                this.upstageService.isKoreanOrJapanese(lastMessage)) ||
                               (this.useOpenRouter && this.openRouterService.isReady() && 
                                this.openRouterService.detectKorean(lastMessage));
    
    // Use thinking cascade if enableThinking is set
    let cascade;
    if (enableThinking) {
      cascade = this.getThinkingCascade();
      this.logger.log(`🧠 Using thinking cascade (enableThinking=true)`);
    } else if (requestedModel === 'pro') {
      cascade = this.getProCascade();
    } else {
      cascade = this.getFlashCascade();
    }

    // Create wrapper emitter (for fallback handling)
    const wrapperEmitter = new EventEmitter();
    let currentIndex = 0;
    let hasReceivedData = false;
    let totalResponseLength = 0;
    let finalModelUsed = 'unknown';

    const tryNextModel = async () => {
      if (currentIndex >= cascade.length) {
        wrapperEmitter.emit('error', new Error('CASCADE_FALLBACK_NEEDED'));
        return;
      }

      const item = cascade[currentIndex];
      currentIndex++;

      try {
        const result = await this.tryStreamModel(messages, item.type, item.model, item.name);
        if (!result) {
          // Model not available, try next
          await tryNextModel();
          return;
        }

        const { emitter, modelUsed } = result;
        finalModelUsed = modelUsed;

        emitter.on('data', (chunk: string) => {
          hasReceivedData = true;
          totalResponseLength += chunk.length;
          wrapperEmitter.emit('data', chunk);
        });

        emitter.on('end', async () => {
          // Stream completed but response is empty, fall back to next model
          if (!hasReceivedData || totalResponseLength === 0) {
            this.logger.warn(`⚠️ ${item.name} stream completed but empty response, trying next model`);
            await tryNextModel();
            return;
          }
          
          wrapperEmitter.emit('end');
        });

        emitter.on('error', async (error: Error) => {
          if (!hasReceivedData) {
            // Error before receiving data → fall back to next model
            this.logger.warn(`⚠️ ${item.name} stream error before data, trying next: ${error.message}`);
            await tryNextModel();
          } else {
            // Error after receiving data → propagate error
            wrapperEmitter.emit('error', error);
          }
        });

        // Pass modelUsed info
        (wrapperEmitter as any).modelUsed = modelUsed;

      } catch (error) {
        this.logger.warn(`⚠️ ${item.name} failed to start: ${error.message}`);
        await tryNextModel();
      }
    };

    // Try first model
    await tryNextModel();

    return {
      emitter: wrapperEmitter,
      modelUsed: (wrapperEmitter as any).modelUsed || 'unknown',
    };
  }

  /**
   * Thinking (reasoning) cascade order
   * DeepSeek R1 (free) → Qwen3 235B (free) → Qwen3 Next 80B (free)
   */
  getThinkingCascade() {
    if (this.cascadeConfig?.thinking?.length) return this.cascadeConfig.thinking;
    return this.getDefaultThinkingCascade();
  }

  private getDefaultThinkingCascade() {
    return [
      { type: 'openrouter', model: OPENROUTER_MODELS.DEEPSEEK_R1, name: 'DeepSeek R1 0528' },
      { type: 'openrouter', model: OPENROUTER_MODELS.QWEN3_235B, name: 'Qwen3 235B' },
      { type: 'openrouter', model: OPENROUTER_MODELS.QWEN3_NEXT_80B, name: 'Qwen3 Next 80B' },
    ];
  }

  /**
   * Generate search query
   */
  generateSearchQuery(userMessage: string): string {
    let query = userMessage.replace(/[?？]/g, '');
    
    const stopWords = [
      'hello', 'tell', 'find', 'search', 'please', 'me', 'the', 'a', 'an',
      'hi', 'hello', 'please', 'tell', 'me', 'find', 'search', 'the', 'a', 'an',
    ];
    
    for (const word of stopWords) {
      query = query.split(word).join(' ');
    }
    
    query = query.replace(/\s+/g, ' ').trim();
    
    return query || userMessage;
  }

  /**
   * Vision model streaming (image analysis)
   * Routes messages containing images to a vision model
   */
  async chatVisionStream(
    messages: Array<{ role: string; content: any }>,
  ): Promise<{ emitter: EventEmitter; modelUsed: string }> {
    if (!this.useOpenRouter || !this.openRouterService.isReady()) {
      throw new Error('OpenRouter not available for vision');
    }

    const visionCascade = [
      { model: OPENROUTER_VISION_MODELS.QWEN_VL_72B, name: 'Qwen2.5-VL 72B' },
      { model: OPENROUTER_VISION_MODELS.LLAMA_VISION_11B, name: 'Llama 3.2 Vision 11B' },
    ];

    for (const item of visionCascade) {
      try {
        this.logger.log(`🖼️ Trying vision model: ${item.name}`);
        const result = await this.openRouterService.chatVisionStream(messages, item.model);
        return result;
      } catch (error) {
        this.logger.warn(`⚠️ Vision model ${item.name} failed: ${error.message}`);
        continue;
      }
    }

    throw new Error('ALL_VISION_MODELS_FAILED');
  }

  isReady(): boolean {
    return (this.useOpenRouter && this.openRouterService.isReady()) ||
           (this.useGrok && this.grokService.isReady()) ||
           (this.useVenice && this.veniceService.isReady()) ||
           (this.useZai && this.zaiService.isReady()) ||
           (this.useCloudflare && this.cloudflareService.isReady());
  }

  getAvailableModels(): string[] {
    const models: string[] = [];
    if (this.useOpenRouter && this.openRouterService.isReady()) {
      models.push('openrouter:solar-pro-3', 'openrouter:step-3.5-flash', 'openrouter:qwen3-next-80b');
    }
    if (this.useZai && this.zaiService.isReady()) {
      models.push('zai-flash');
    }
    if (this.useCloudflare && this.cloudflareService.isReady()) {
      models.push('cloudflare-llama');
    }
    return models;
  }
}
