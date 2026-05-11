import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { EventEmitter } from 'events';
import { ToolDefinition } from './sayknowbot-tools';

/**
 * OpenAI provider service.
 *
 * Mirrors the shape of OpenRouterService so the router can swap providers
 * with no special-casing beyond a `type === 'openai'` branch. Uses the
 * official `openai` Node SDK instead of raw axios so streaming and tool
 * calls follow upstream conventions.
 *
 * Keys are user-scoped: the web app pushes the active member's OpenAI key
 * into `updateApiKey()` at request time. We do not keep a long-lived
 * fallback key here.
 */

interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatResult {
  content: string;
  tokensUsed: number;
  modelUsed: string;
  fallbackUsed: boolean;
  toolCalls?: ToolCall[];
}

// OpenAI vision-capable models. GPT-4o family handles images natively.
export const OPENAI_VISION_MODELS = {
  GPT_4O: 'gpt-4o',
  GPT_4O_MINI: 'gpt-4o-mini',
};

// OpenAI chat models. Ordered roughly by cost-quality tradeoff — cheaper
// models come first so router fallback hits the affordable ones earlier.
export const OPENAI_MODELS = {
  GPT_4O_MINI: 'gpt-4o-mini',
  GPT_4O: 'gpt-4o',
  GPT_4_1_MINI: 'gpt-4.1-mini',
  GPT_4_1: 'gpt-4.1',
  O3_MINI: 'o3-mini',
};

@Injectable()
export class OpenAIService implements OnModuleInit {
  private readonly logger = new Logger(OpenAIService.name);
  private client: OpenAI | null = null;
  private apiKey: string;
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    // Falls back to an env-level key if one exists. The web app overwrites
    // this per-request via updateApiKey() with the member's stored key.
    this.apiKey = this.configService.get('OPENAI_API_KEY', '');
  }

  async onModuleInit() {
    if (this.apiKey) {
      this.client = new OpenAI({ apiKey: this.apiKey });
      this.isConfigured = true;
      this.logger.log('✅ OpenAI configured');
    } else {
      this.logger.warn('⚠️ OpenAI API key not configured');
    }
  }

  isReady(): boolean {
    return this.isConfigured && this.client !== null;
  }

  updateApiKey(key: string) {
    this.apiKey = key;
    if (key) {
      this.client = new OpenAI({ apiKey: key });
      this.isConfigured = true;
    } else {
      this.client = null;
      this.isConfigured = false;
    }
    this.logger.log(`🔑 OpenAI key ${key ? 'updated' : 'removed'}`);
  }

  /** Non-streaming chat completion (with optional function calling tools). */
  async chat(messages: ChatMessage[], model: string, tools?: ToolDefinition[]): Promise<ChatResult> {
    if (!this.isReady() || !this.client) {
      throw new Error('OpenAI not configured');
    }

    const startTime = Date.now();
    this.logger.log(`🤖 OpenAI request: model=${model}, tools=${tools ? tools.length : 0}`);

    try {
      const body: any = {
        model,
        messages: messages.map((m) => {
          const msg: any = { role: m.role as any, content: m.content };
          if (m.tool_calls) msg.tool_calls = m.tool_calls;
          if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
          if (m.name) msg.name = m.name;
          return msg;
        }),
        temperature: 0.5,
        max_tokens: 16384,
      };
      if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      const completion = await this.client.chat.completions.create(body);
      const choice = completion.choices?.[0];
      const content = choice?.message?.content ?? '';
      const toolCalls = (choice?.message as any)?.tool_calls as ToolCall[] | undefined;
      const tokensUsed = completion.usage?.total_tokens ?? 0;
      const elapsed = Date.now() - startTime;

      this.logger.log(
        `✅ OpenAI responded: ${elapsed}ms, tokens=${tokensUsed}, model=${model}, toolCalls=${toolCalls?.length ?? 0}`,
      );

      return {
        content,
        tokensUsed,
        modelUsed: `openai:${model}`,
        fallbackUsed: false,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error: any) {
      const status = error?.status as number | undefined;
      const errorMsg = error?.message ?? String(error);
      this.logger.error(`❌ OpenAI error: ${status} - ${errorMsg}`);

      // Surface 429 in a router-friendly shape so fallback logic can detect it.
      if (status === 429) {
        const wrapped = new Error(`Rate limit: ${model}`);
        (wrapped as any).status = 429;
        throw wrapped;
      }
      throw error;
    }
  }

  /** Streaming chat completion. Returns an EventEmitter (data/end/error). */
  async chatStream(
    messages: ChatMessage[],
    model: string,
  ): Promise<{ emitter: EventEmitter; modelUsed: string }> {
    if (!this.isReady() || !this.client) {
      throw new Error('OpenAI not configured');
    }

    const emitter = new EventEmitter();
    const startTime = Date.now();
    this.logger.log(`🤖 OpenAI stream request: model=${model}`);

    // We need to return the emitter synchronously, so the actual stream
    // consumption runs asynchronously and pushes events as they arrive.
    void (async () => {
      try {
        const stream = await this.client!.chat.completions.create({
          model,
          messages: messages.map((m) => ({
            role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })) as any,
          temperature: 0.5,
          max_tokens: 16384,
          stream: true,
        });

        let fullContent = '';
        for await (const chunk of stream as any) {
          const content = chunk?.choices?.[0]?.delta?.content ?? '';
          if (content) {
            fullContent += content;
            emitter.emit('data', content);
          }
        }

        const elapsed = Date.now() - startTime;
        if (!fullContent || fullContent.trim().length === 0) {
          this.logger.warn(`⚠️ OpenAI returned empty response: model=${model}`);
          emitter.emit('error', new Error(`Empty response from ${model}`));
          return;
        }
        this.logger.log(`✅ OpenAI stream completed: ${elapsed}ms, model=${model}`);
        emitter.emit('end');
      } catch (error: any) {
        const status = error?.status as number | undefined;
        this.logger.error(`❌ OpenAI stream error: ${error?.message ?? error}`);
        if (status === 429) {
          const wrapped = new Error(`Rate limit: ${model}`);
          (wrapped as any).status = 429;
          emitter.emit('error', wrapped);
        } else {
          emitter.emit('error', error);
        }
      }
    })();

    return { emitter, modelUsed: `openai:${model}` };
  }

  /**
   * Streaming chat for multimodal (image) input. GPT-4o variants accept
   * `content` as an array of `{ type: 'text' | 'image_url', ... }` parts —
   * we forward whatever the caller built.
   */
  async chatVisionStream(
    messages: Array<{ role: string; content: any }>,
    model: string,
  ): Promise<{ emitter: EventEmitter; modelUsed: string }> {
    if (!this.isReady() || !this.client) {
      throw new Error('OpenAI not configured');
    }

    const emitter = new EventEmitter();
    const startTime = Date.now();
    this.logger.log(`🖼️ OpenAI vision stream: model=${model}`);

    void (async () => {
      try {
        const stream = await this.client!.chat.completions.create({
          model,
          messages: messages as any,
          temperature: 0.5,
          max_tokens: 16384,
          stream: true,
        });

        let fullContent = '';
        for await (const chunk of stream as any) {
          const content = chunk?.choices?.[0]?.delta?.content ?? '';
          if (content) {
            fullContent += content;
            emitter.emit('data', content);
          }
        }

        const elapsed = Date.now() - startTime;
        if (!fullContent || fullContent.trim().length === 0) {
          this.logger.warn(`⚠️ OpenAI vision returned empty response: model=${model}`);
          emitter.emit('error', new Error(`Empty vision response from ${model}`));
          return;
        }
        this.logger.log(`✅ OpenAI vision stream completed: ${elapsed}ms, model=${model}`);
        emitter.emit('end');
      } catch (error: any) {
        const status = error?.status as number | undefined;
        this.logger.error(`❌ OpenAI vision error: ${error?.message ?? error}`);
        if (status === 429) {
          const wrapped = new Error(`Rate limit: ${model}`);
          (wrapped as any).status = 429;
          emitter.emit('error', wrapped);
        } else {
          emitter.emit('error', error);
        }
      }
    })();

    return { emitter, modelUsed: `openai:${model}` };
  }

  /** Simple Korean detector — kept in sync with OpenRouterService's helper. */
  detectKorean(text: string): boolean {
    // Korean Unicode range: AC00-D7AF (syllables), 1100-11FF (jamo)
    const koreanRegex = /[가-힯ᄀ-ᇿ]/;
    return koreanRegex.test(text);
  }
}
