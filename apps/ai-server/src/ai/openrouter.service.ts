import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';
import { SAYKNOWBOT_TOOLS, ToolDefinition } from './sayknowbot-tools';

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

// OpenRouter vision models (for image analysis)
export const OPENROUTER_VISION_MODELS = {
  QWEN_VL_72B: 'qwen/qwen2.5-vl-72b-instruct:free',
  LLAMA_VISION_11B: 'meta-llama/llama-3.2-11b-vision-instruct:free',
};

// OpenRouter free model list
export const OPENROUTER_MODELS = {
  // SayKnow AI Pro models (uncensored, quality-first)
  DOLPHIN_VENICE: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', // Primary Pro — uncensored
  HERMES_405B: 'nousresearch/hermes-3-llama-3.1-405b:free',  // Fallback Pro — uncensored 405B

  // OpenRouter paid models (fallback)
  GROK_41_FAST: 'x-ai/grok-4.1-fast',                       // Grok 4.1 Fast — $0.20/$0.50

  // Legacy SayKnowAI models (fallback)
  SOLAR_PRO_3: 'upstage/solar-pro-3:free',           // Korean specialized
  STEP_35_FLASH: 'stepfun/step-3.5-flash:free',      // Fast and high quality
  QWEN3_NEXT_80B: 'qwen/qwen3-next-80b-a3b-instruct:free', // Large model
  LLAMA_33_70B: 'meta-llama/llama-3.3-70b-instruct:free',   // Meta 70B
  GEMMA_3_27B: 'google/gemma-3-27b-it:free',         // Google lightweight model (Google AI Studio)
  DEEPSEEK_R1: 'deepseek/deepseek-r1-0528:free',     // DeepSeek R1
  QWEN3_235B: 'qwen/qwen3-235b-a22b:free',           // Qwen3 235B (thinking support)
  
  // Flash models (speed-first)
  GLM_45_AIR: 'zhipu/glm-4.5-air:free',              // Fast
  
  // Additional fallback
  LLAMA_4_MAVERICK: 'meta-llama/llama-4-maverick:free',
  DEEPSEEK_V3: 'deepseek/deepseek-v3-base:free',
};

@Injectable()
export class OpenRouterService implements OnModuleInit {
  private readonly logger = new Logger(OpenRouterService.name);
  private client: AxiosInstance;
  private apiKey: string;
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('OPENROUTER_API_KEY', '');
    
    this.client = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sayknow.ai',
        'X-Title': 'SayKnow AI',
      },
    });
  }

  async onModuleInit() {
    if (this.apiKey) {
      this.isConfigured = true;
      this.logger.log('✅ OpenRouter configured');
      this.logger.log(`   Available models: Solar Pro 3, Step 3.5 Flash, Qwen3 Next 80B, GLM 4.5 Air, Gemma 3 27B`);
    } else {
      this.logger.warn('⚠️ OpenRouter API key not configured');
    }
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  updateApiKey(key: string) {
    this.apiKey = key;
    this.isConfigured = !!key;
    if (key) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${key}`;
    }
    this.logger.log(`🔑 OpenRouter key ${key ? 'updated' : 'removed'}`);
  }

  /**
   * OpenRouter chat (non-streaming)
   * @param tools - SayKnowbot Tool definitions (optional, used only in Electron environment)
   */
  async chat(messages: ChatMessage[], model: string, tools?: ToolDefinition[]): Promise<ChatResult> {
    if (!this.isConfigured) {
      throw new Error('OpenRouter not configured');
    }

    const startTime = Date.now();
    this.logger.log(`🌐 OpenRouter request: model=${model}, tools=${tools ? tools.length : 0}`);

    try {
      // Build request body
      const requestBody: any = {
        model,
        messages: messages.map(m => {
          const msg: any = {
            role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : m.role === 'tool' ? 'tool' : 'user',
            content: m.content,
          };
          // Add Tool-related fields
          if (m.tool_calls) msg.tool_calls = m.tool_calls;
          if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
          if (m.name) msg.name = m.name;
          return msg;
        }),
        temperature: 0.5,
        max_tokens: 16384,
        stream: false,
      };

      // Add tools if present (Function Calling)
      if (tools && tools.length > 0) {
        requestBody.tools = tools;
        requestBody.tool_choice = 'auto'; // AI automatically decides whether to call tools
      }

      const response = await this.client.post('/chat/completions', requestBody, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      const choice = response.data.choices?.[0];
      const content = choice?.message?.content || '';
      const toolCalls = choice?.message?.tool_calls;
      const tokensUsed = response.data.usage?.total_tokens || 0;
      const elapsed = Date.now() - startTime;

      this.logger.log(`✅ OpenRouter responded: ${elapsed}ms, tokens=${tokensUsed}, model=${model}, toolCalls=${toolCalls?.length || 0}`);

      return {
        content,
        tokensUsed,
        modelUsed: `openrouter:${model}`,
        fallbackUsed: false,
        toolCalls: toolCalls || undefined,
      };
    } catch (error) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error?.message || error.message;
      
      this.logger.error(`❌ OpenRouter error: ${status} - ${errorMsg}`);
      
      // Distinguish rate limit errors
      if (status === 429) {
        const err = new Error(`Rate limit: ${model}`);
        (err as any).status = 429;
        throw err;
      }
      
      throw error;
    }
  }

  /**
   * OpenRouter streaming chat
   */
  async chatStream(messages: ChatMessage[], model: string): Promise<{
    emitter: EventEmitter;
    modelUsed: string;
  }> {
    if (!this.isConfigured) {
      throw new Error('OpenRouter not configured');
    }

    const emitter = new EventEmitter();
    const startTime = Date.now();
    
    this.logger.log(`🌐 OpenRouter stream request: model=${model}`);

    try {
      // Free model optimization: encourage short and concise responses
      const response = await this.client.post('/chat/completions', {
        model,
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        temperature: 0.5,
        max_tokens: 16384,
        stream: true,
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        responseType: 'stream',
      });

      let fullContent = '';
      let streamEnded = false;
      let sseBuffer = '';

      response.data.on('data', (chunk: Buffer) => {
        sseBuffer += chunk.toString('utf-8');
        const parts = sseBuffer.split('\n');
        sseBuffer = parts.pop() || '';
        const lines = parts.filter(line => line.trim() !== '');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              if (streamEnded) return;
              streamEnded = true;
              
              const elapsed = Date.now() - startTime;
              this.logger.log(`✅ OpenRouter stream completed: ${elapsed}ms, model=${model}`);
              
              // Empty response treated as error → triggers fallback
              if (!fullContent || fullContent.trim().length === 0) {
                this.logger.warn(`⚠️ OpenRouter returned empty response: model=${model}`);
                emitter.emit('error', new Error(`Empty response from ${model}`));
                return;
              }
              
              emitter.emit('end');
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
                emitter.emit('data', content);
              }
            } catch (e) {
              // Ignore JSON parse failures
            }
          }
        }
      });

      response.data.on('error', (error: Error) => {
        this.logger.error(`❌ OpenRouter stream error: ${error.message}`);
        emitter.emit('error', error);
      });

      response.data.on('end', () => {
        // Already handled in [DONE], skip
        if (streamEnded) return;
        streamEnded = true;
        
        // Stream ended without [DONE] and response is empty → error
        if (!fullContent || fullContent.trim().length === 0) {
          this.logger.warn(`⚠️ OpenRouter stream ended without content: model=${model}`);
          emitter.emit('error', new Error(`Empty response from ${model}`));
          return;
        }
        
        emitter.emit('end');
      });

      return {
        emitter,
        modelUsed: `openrouter:${model}`,
      };
    } catch (error) {
      const status = error.response?.status;
      
      if (status === 429) {
        const err = new Error(`Rate limit: ${model}`);
        (err as any).status = 429;
        throw err;
      }
      
      throw error;
    }
  }

  /**
   * OpenRouter vision model streaming (image analysis)
   * Multimodal request with image content in messages
   */
  async chatVisionStream(
    messages: Array<{ role: string; content: any }>,
    model: string,
  ): Promise<{ emitter: EventEmitter; modelUsed: string }> {
    if (!this.isConfigured) {
      throw new Error('OpenRouter not configured');
    }

    const emitter = new EventEmitter();
    const startTime = Date.now();

    this.logger.log(`🖼️ OpenRouter vision stream: model=${model}`);

    try {
      const response = await this.client.post('/chat/completions', {
        model,
        messages,
        temperature: 0.5,
        max_tokens: 16384,
        stream: true,
      }, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        responseType: 'stream',
      });

      let fullContent = '';
      let streamEnded = false;
      let sseBuffer = '';

      response.data.on('data', (chunk: Buffer) => {
        sseBuffer += chunk.toString('utf-8');
        const parts = sseBuffer.split('\n');
        sseBuffer = parts.pop() || '';
        const lines = parts.filter(line => line.trim() !== '');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              if (streamEnded) return;
              streamEnded = true;
              const elapsed = Date.now() - startTime;
              this.logger.log(`✅ Vision stream completed: ${elapsed}ms, model=${model}`);
              if (!fullContent || fullContent.trim().length === 0) {
                emitter.emit('error', new Error(`Empty vision response from ${model}`));
                return;
              }
              emitter.emit('end');
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
                emitter.emit('data', content);
              }
            } catch (e) { /* ignore */ }
          }
        }
      });

      response.data.on('error', (error: Error) => {
        this.logger.error(`❌ Vision stream error: ${error.message}`);
        emitter.emit('error', error);
      });

      response.data.on('end', () => {
        if (streamEnded) return;
        streamEnded = true;
        if (!fullContent || fullContent.trim().length === 0) {
          emitter.emit('error', new Error(`Empty vision response from ${model}`));
          return;
        }
        emitter.emit('end');
      });

      return { emitter, modelUsed: `openrouter:${model}` };
    } catch (error) {
      const status = error.response?.status;
      if (status === 429) {
        const err = new Error(`Rate limit: ${model}`);
        (err as any).status = 429;
        throw err;
      }
      throw error;
    }
  }

  /**
   * Language detection (simple Korean detection)
   */
  detectKorean(text: string): boolean {
    // Korean Unicode range: AC00-D7AF (syllables), 1100-11FF (jamo)
    const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF]/;
    return koreanRegex.test(text);
  }
}
