import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatResult {
  content: string;
  tokensUsed: number;
  modelUsed: string;
  fallbackUsed: boolean;
}

@Injectable()
export class CloudflareService implements OnModuleInit {
  private readonly logger = new Logger(CloudflareService.name);
  private client: AxiosInstance;
  private accountId: string;
  private apiToken: string;
  private isAvailable: boolean = false;

  // Cloudflare Workers AI models
  private readonly models = {
    'llama-70b': '@cf/meta/llama-3.1-70b-instruct',
    'llama-8b': '@cf/meta/llama-3.1-8b-instruct',
  };

  constructor(private configService: ConfigService) {
    this.accountId = this.configService.get('CLOUDFLARE_ACCOUNT_ID', '');
    this.apiToken = this.configService.get('CLOUDFLARE_API_TOKEN', '');

    if (this.accountId && this.apiToken) {
      this.client = axios.create({
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai`,
        timeout: 120000, // 70B model can be slow
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
      });
    }

    this.logger.log(`☁️ Cloudflare Service initialized (Account: ${this.accountId ? 'configured' : 'not configured'})`);
  }

  async onModuleInit() {
    if (!this.accountId || !this.apiToken) {
      this.logger.warn('⚠️ Cloudflare credentials not configured');
      return;
    }

    await this.checkAvailability();
  }

  private async checkAvailability() {
    try {
      // Simple test request (quick check with 8B model)
      const response = await this.client.post(`/run/${this.models['llama-8b']}`, {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10,
      }, { timeout: 15000 });

      if (response.data?.result?.response) {
        this.isAvailable = true;
        this.logger.log('✅ Cloudflare Workers AI connected successfully');
      }
    } catch (error) {
      this.isAvailable = false;
      this.logger.warn(`⚠️ Cloudflare Workers AI not available: ${error.message}`);
    }
  }

  /**
   * Synchronous chat request
   */
  async chat(messages: ChatMessage[], useHighQuality: boolean = true): Promise<ChatResult> {
    const modelKey = useHighQuality ? 'llama-70b' : 'llama-8b';
    const model = this.models[modelKey];

    this.logger.log(`☁️ Cloudflare chat request: model=${modelKey}, messages=${messages.length}`);
    const startTime = Date.now();

    try {
      const response = await this.client.post(`/run/${model}`, {
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        max_tokens: 4096,
        temperature: 0.7,
      });

      const content = response.data?.result?.response || '';
      // Cloudflare doesn't provide token usage directly, using estimates
      const tokensUsed = Math.ceil(content.length / 4) + messages.reduce((acc, m) => acc + m.content.length / 4, 0);

      this.logger.log(`✅ Cloudflare response: ${content.length} chars (${Date.now() - startTime}ms)`);

      return {
        content,
        tokensUsed: Math.ceil(tokensUsed),
        modelUsed: `cloudflare-${modelKey}`,
        fallbackUsed: false,
      };
    } catch (error) {
      this.logger.error(`❌ Cloudflare chat error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Streaming chat request
   */
  async chatStream(messages: ChatMessage[], useHighQuality: boolean = true): Promise<{
    emitter: EventEmitter;
    modelUsed: string;
  }> {
    const modelKey = useHighQuality ? 'llama-70b' : 'llama-8b';
    const model = this.models[modelKey];

    this.logger.log(`☁️ Cloudflare stream request: model=${modelKey}`);

    const emitter = new EventEmitter();

    this.processStream(messages, model, modelKey, emitter).catch(error => {
      emitter.emit('error', error);
    });

    return {
      emitter,
      modelUsed: `cloudflare-${modelKey}`,
    };
  }

  private async processStream(
    messages: ChatMessage[],
    model: string,
    modelKey: string,
    emitter: EventEmitter,
  ) {
    try {
      const response = await this.client.post(`/run/${model}`, {
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        max_tokens: 4096,
        temperature: 0.7,
        stream: true,
      }, {
        responseType: 'stream',
      });

      let buffer = '';

      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.includes('[DONE]')) continue;

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.response;
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
      this.logger.error(`❌ Cloudflare stream error: ${error.message}`);
      emitter.emit('error', error);
    }
  }

  isReady(): boolean {
    return this.isAvailable && !!this.accountId && !!this.apiToken;
  }

  updateApiKey(key: string, accountId?: string) {
    this.apiToken = key;
    if (accountId) this.accountId = accountId;
    this.isAvailable = !!(key && this.accountId);
    if (this.isAvailable) {
      this.client = axios.create({
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai`,
        timeout: 120000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });
    }
    this.logger.log(`🔑 Cloudflare key ${key ? 'updated' : 'removed'}`);
  }
}
