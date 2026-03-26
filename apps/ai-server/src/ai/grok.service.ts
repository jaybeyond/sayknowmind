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

export const GROK_MODELS = {
  GROK_41_FAST: 'grok-4-1-fast-reasoning',  // Grok 4.1 Fast Reasoning
  GROK_3_MINI: 'grok-3-mini-fast',          // Cheaper option
};

@Injectable()
export class GrokService implements OnModuleInit {
  private readonly logger = new Logger(GrokService.name);
  private client: AxiosInstance;
  private apiKey: string;
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('XAI_API_KEY', '');

    this.client = axios.create({
      baseURL: 'https://api.x.ai/v1',
      timeout: 120000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async onModuleInit() {
    if (this.apiKey) {
      this.isConfigured = true;
      this.logger.log('✅ Grok (xAI) configured');
      this.logger.log('   Models: Grok 3 Fast, Grok 3 Mini Fast');
    } else {
      this.logger.warn('⚠️ XAI_API_KEY not configured — Grok fallback disabled');
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
    this.logger.log(`🔑 Grok key ${key ? 'updated' : 'removed'}`);
  }

  async chat(messages: ChatMessage[], model?: string): Promise<ChatResult> {
    if (!this.isConfigured) throw new Error('Grok not configured');

    const useModel = model || GROK_MODELS.GROK_41_FAST;
    const startTime = Date.now();
    this.logger.log(`🤖 Grok request: model=${useModel}`);

    try {
      const response = await this.client.post('/chat/completions', {
        model: useModel,
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        temperature: 0.7,
        max_tokens: 16384,
        stream: false,
      }, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      const content = response.data.choices?.[0]?.message?.content || '';
      const tokensUsed = response.data.usage?.total_tokens || 0;
      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ Grok responded: ${elapsed}ms, tokens=${tokensUsed}, model=${useModel}`);

      return { content, tokensUsed, modelUsed: `grok:${useModel}`, fallbackUsed: true };
    } catch (error) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(`❌ Grok error: ${status} - ${errorMsg}`);
      if (status === 429) {
        const err = new Error(`Rate limit: grok:${useModel}`);
        (err as any).status = 429;
        throw err;
      }
      throw error;
    }
  }

  async chatStream(messages: ChatMessage[], model?: string): Promise<{
    emitter: EventEmitter;
    modelUsed: string;
  }> {
    if (!this.isConfigured) throw new Error('Grok not configured');

    const useModel = model || GROK_MODELS.GROK_41_FAST;
    const emitter = new EventEmitter();
    const startTime = Date.now();
    this.logger.log(`🤖 Grok stream request: model=${useModel}`);

    try {
      const response = await this.client.post('/chat/completions', {
        model: useModel,
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        temperature: 0.7,
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
              this.logger.log(`✅ Grok stream completed: ${elapsed}ms, model=${useModel}`);
              if (!fullContent.trim()) {
                emitter.emit('error', new Error(`Empty response from grok:${useModel}`));
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
            } catch { /* ignore */ }
          }
        }
      });

      response.data.on('error', (error: Error) => {
        this.logger.error(`❌ Grok stream error: ${error.message}`);
        emitter.emit('error', error);
      });

      response.data.on('end', () => {
        if (streamEnded) return;
        streamEnded = true;
        if (!fullContent.trim()) {
          emitter.emit('error', new Error(`Empty response from grok:${useModel}`));
          return;
        }
        emitter.emit('end');
      });

      return { emitter, modelUsed: `grok:${useModel}` };
    } catch (error) {
      const status = error.response?.status;
      if (status === 429) {
        const err = new Error(`Rate limit: grok:${useModel}`);
        (err as any).status = 429;
        throw err;
      }
      throw error;
    }
  }
}
