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

// Venice AI model list (uncensored priority)
export const VENICE_MODELS = {
  UNCENSORED: 'venice-uncensored',           // Venice Uncensored 1.1 — $0.20/$0.90
  MEDIUM: 'mistral-31-24b',                  // Venice Medium (Mistral 24B) — $0.50/$2.00
  HERMES_405B: 'hermes-3-llama-3.1-405b',   // Hermes 3 405B — $1.10/$3.00
  LLAMA_70B: 'llama-3.3-70b',               // Llama 3.3 70B — $0.70/$2.80
};

@Injectable()
export class VeniceService implements OnModuleInit {
  private readonly logger = new Logger(VeniceService.name);
  private client: AxiosInstance;
  private apiKey: string;
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('VENICE_API_KEY', '');

    this.client = axios.create({
      baseURL: 'https://api.venice.ai/api/v1',
      timeout: 120000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async onModuleInit() {
    if (this.apiKey) {
      this.isConfigured = true;
      this.logger.log('✅ Venice AI configured (uncensored fallback)');
      this.logger.log('   Models: Venice Uncensored, Mistral 24B, Hermes 405B');
    } else {
      this.logger.warn('⚠️ VENICE_API_KEY not configured — Venice fallback disabled');
    }
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  /**
   * Venice AI chat (non-streaming)
   */
  async chat(messages: ChatMessage[], model?: string): Promise<ChatResult> {
    if (!this.isConfigured) throw new Error('Venice AI not configured');

    const useModel = model || VENICE_MODELS.UNCENSORED;
    const startTime = Date.now();
    this.logger.log(`🎭 Venice request: model=${useModel}`);

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
        venice_parameters: {
          include_venice_system_prompt: false,
        },
      }, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      const content = response.data.choices?.[0]?.message?.content || '';
      const tokensUsed = response.data.usage?.total_tokens || 0;
      const elapsed = Date.now() - startTime;

      this.logger.log(`✅ Venice responded: ${elapsed}ms, tokens=${tokensUsed}, model=${useModel}`);

      return {
        content,
        tokensUsed,
        modelUsed: `venice:${useModel}`,
        fallbackUsed: true,
      };
    } catch (error) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(`❌ Venice error: ${status} - ${errorMsg}`);

      if (status === 429) {
        const err = new Error(`Rate limit: venice:${useModel}`);
        (err as any).status = 429;
        throw err;
      }
      throw error;
    }
  }

  /**
   * Venice AI streaming chat
   */
  async chatStream(messages: ChatMessage[], model?: string): Promise<{
    emitter: EventEmitter;
    modelUsed: string;
  }> {
    if (!this.isConfigured) throw new Error('Venice AI not configured');

    const useModel = model || VENICE_MODELS.UNCENSORED;
    const emitter = new EventEmitter();
    const startTime = Date.now();

    this.logger.log(`🎭 Venice stream request: model=${useModel}`);

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
        venice_parameters: {
          include_venice_system_prompt: false,
        },
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
              this.logger.log(`✅ Venice stream completed: ${elapsed}ms, model=${useModel}`);

              if (!fullContent || fullContent.trim().length === 0) {
                emitter.emit('error', new Error(`Empty response from venice:${useModel}`));
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
            } catch {
              // ignore parse errors
            }
          }
        }
      });

      response.data.on('error', (error: Error) => {
        this.logger.error(`❌ Venice stream error: ${error.message}`);
        emitter.emit('error', error);
      });

      response.data.on('end', () => {
        if (streamEnded) return;
        streamEnded = true;
        if (!fullContent || fullContent.trim().length === 0) {
          emitter.emit('error', new Error(`Empty response from venice:${useModel}`));
          return;
        }
        emitter.emit('end');
      });

      return { emitter, modelUsed: `venice:${useModel}` };
    } catch (error) {
      const status = error.response?.status;
      if (status === 429) {
        const err = new Error(`Rate limit: venice:${useModel}`);
        (err as any).status = 429;
        throw err;
      }
      throw error;
    }
  }
}
