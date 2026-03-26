import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';

interface ChatMessage {
  role: string;
  content: string;
}

interface ModelConfig {
  model: string;
  description: string;
  timeout: number;
  maxTokens: number;
}

interface ChatResult {
  content: string;
  tokensUsed: number;
  modelUsed: string;
  fallbackUsed: boolean;
}

@Injectable()
export class ZaiService implements OnModuleInit {
  private readonly logger = new Logger(ZaiService.name);
  private client: AxiosInstance;
  private apiKey: string;
  private isAvailable: boolean = false;

  // z.ai model configuration
  private readonly modelConfigs: Record<string, ModelConfig> = {
    pro: {
      model: 'glm-4.7',
      description: 'GLM-4.7 (high quality)',
      timeout: 60000,
      maxTokens: 4096,
    },
    flash: {
      model: 'glm-4.7-flash',
      description: 'GLM-4.7-Flash (fast, free)',
      timeout: 30000,
      maxTokens: 4096,
    },
  };

  private defaultModel = 'flash'; // Default: fast free model

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('ZAI_API_KEY', '');
    const baseUrl = this.configService.get('ZAI_API_URL', 'https://api.z.ai/api/paas/v4');

    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 90000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    this.logger.log(`🤖 Z.AI Service initialized (API Key: ${this.apiKey ? 'configured' : 'not configured'})`);
  }

  async onModuleInit() {
    if (!this.apiKey) {
      this.logger.warn('⚠️ ZAI_API_KEY not configured, z.ai service disabled');
      return;
    }

    await this.checkAvailability();
  }

  /**
   * Check z.ai API connectivity
   */
  private async checkAvailability() {
    try {
      // Simple test request
      const response = await this.client.post('/chat/completions', {
        model: 'glm-4.7-flash',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10,
      }, { timeout: 60000 });

      if (response.data?.choices?.[0]?.message) {
        this.isAvailable = true;
        this.logger.log('✅ Z.AI API connected successfully');
      }
    } catch (error) {
      this.isAvailable = false;
      this.logger.warn(`⚠️ Z.AI API not available: ${error.message}`);
    }
  }

  /**
   * Synchronous chat request
   */
  async chat(messages: ChatMessage[], aiModel?: string): Promise<ChatResult> {
    const modelKey = aiModel || this.defaultModel;
    const config = this.modelConfigs[modelKey] || this.modelConfigs[this.defaultModel];

    this.logger.log(`🤖 Z.AI chat request: model=${config.model}, messages=${messages.length}`);
    const startTime = Date.now();

    try {
      const response = await this.client.post('/chat/completions', {
        model: config.model,
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        max_tokens: config.maxTokens,
        temperature: 0.7,
        stream: false,
      }, { timeout: config.timeout });

      // Z.AI GLM-4.7 sometimes puts the response in reasoning_content
      const message = response.data.choices?.[0]?.message || {};
      const content = message.content || message.reasoning_content || '';
      const usage = response.data.usage || {};
      const tokensUsed = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);

      this.logger.log(`✅ Z.AI response: ${content.length} chars, ${tokensUsed} tokens (${Date.now() - startTime}ms)`);

      return {
        content,
        tokensUsed,
        modelUsed: `zai-${modelKey}`,
        fallbackUsed: false,
      };
    } catch (error) {
      this.logger.error(`❌ Z.AI chat error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Streaming chat request
   */
  async chatStream(messages: ChatMessage[], aiModel?: string): Promise<{
    emitter: EventEmitter;
    modelUsed: string;
  }> {
    const modelKey = aiModel || this.defaultModel;
    const config = this.modelConfigs[modelKey] || this.modelConfigs[this.defaultModel];

    this.logger.log(`🤖 Z.AI stream request: model=${config.model}`);

    const emitter = new EventEmitter();

    // Process streaming asynchronously
    this.processStream(messages, config, emitter).catch(error => {
      emitter.emit('error', error);
    });

    return {
      emitter,
      modelUsed: `zai-${modelKey}`,
    };
  }

  private async processStream(
    messages: ChatMessage[],
    config: ModelConfig,
    emitter: EventEmitter,
  ) {
    try {
      const response = await this.client.post('/chat/completions', {
        model: config.model,
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        max_tokens: config.maxTokens,
        temperature: 0.7,
        stream: true,
      }, {
        timeout: config.timeout,
        responseType: 'stream',
      });

      let buffer = '';

      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.trim() === 'data: [DONE]') continue;

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const delta = data.choices?.[0]?.delta || {};
              // Z.AI GLM-4.7 sometimes puts the response in reasoning_content
              const content = delta.content || delta.reasoning_content;
              if (content) {
                emitter.emit('data', content);
              }
            } catch (e) {
              // Ignore JSON parse failures
            }
          }
        }
      });

      response.data.on('end', () => {
        emitter.emit('end');
      });

      response.data.on('error', (error: Error) => {
        emitter.emit('error', error);
      });

    } catch (error) {
      // Send fallback signal on 429 Rate Limit error
      if (error.response?.status === 429) {
        this.logger.warn(`⚠️ Z.AI Rate Limit (429) - triggering fallback`);
      }
      emitter.emit('error', error);
    }
  }

  /**
   * Whether the service is available
   */
  isReady(): boolean {
    return this.isAvailable && !!this.apiKey;
  }

  updateApiKey(key: string) {
    this.apiKey = key;
    this.isAvailable = !!key;
    if (key) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${key}`;
    }
    this.logger.log(`🔑 Z.AI key ${key ? 'updated' : 'removed'}`);
  }

  /**
   * List of available models
   */
  getAvailableModels(): string[] {
    if (!this.isAvailable) return [];
    return Object.keys(this.modelConfigs);
  }
}
