import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import axios from 'axios';

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
export class UpstageService implements OnModuleInit {
  private readonly logger = new Logger(UpstageService.name);
  private apiKey: string | null = null;
  private isAvailable: boolean = false;
  private readonly baseUrl = 'https://api.upstage.ai/v1/solar';
  
  // Upstage model (Korean/Japanese optimized)
  private readonly MODEL = 'solar-pro';  // Solar Pro 3

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const useUpstage = this.configService.get<string>('USE_UPSTAGE', 'false');
    
    if (useUpstage !== 'true') {
      this.logger.log('⏭️ Upstage disabled (USE_UPSTAGE=false)');
      this.isAvailable = false;
      return;
    }
    
    this.apiKey = this.configService.get<string>('UPSTAGE_API_KEY') || null;
    
    if (this.apiKey) {
      // API key validation test
      await this.checkAvailability();
    } else {
      this.logger.warn('⚠️ Upstage API key not configured');
    }
  }

  /**
   * API key validation test (runs once on init)
   */
  private async checkAvailability(): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.MODEL,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      this.isAvailable = true;
      this.logger.log('✅ Upstage API connected (Solar Pro - Korean/Japanese optimized)');
    } catch (error) {
      this.isAvailable = false;
      if (error.response?.status === 401) {
        this.logger.error('❌ Upstage API key is invalid (401 Unauthorized)');
      } else {
        this.logger.warn(`⚠️ Upstage API not available: ${error.message}`);
      }
    }
  }

  isReady(): boolean {
    return !!this.apiKey && this.isAvailable;
  }

  /**
   * Detect Korean/Japanese text
   */
  isKoreanOrJapanese(text: string): boolean {
    // Korean detection
    const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
    // Japanese detection (Hiragana, Katakana, Kanji)
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    
    return koreanRegex.test(text) || japaneseRegex.test(text);
  }

  /**
   * Non-streaming chat
   */
  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new Error('Upstage API key not configured');
    }

    const startTime = Date.now();
    
    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.MODEL,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const elapsed = Date.now() - startTime;
      const content = response.data.choices[0]?.message?.content || '';
      const tokensUsed = response.data.usage?.total_tokens || 0;

      this.logger.log(`✅ Upstage Solar Pro responded: ${elapsed}ms, ${tokensUsed} tokens`);

      return {
        content,
        tokensUsed,
        modelUsed: 'upstage:solar-pro',
        fallbackUsed: false,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.logger.error(`❌ Upstage error after ${elapsed}ms: ${error.message}`);
      throw error;
    }
  }

  /**
   * Streaming chat
   */
  async chatStream(messages: ChatMessage[]): Promise<{
    emitter: EventEmitter;
    modelUsed: string;
  }> {
    if (!this.apiKey || !this.isAvailable) {
      throw new Error('Upstage API not available');
    }

    const emitter = new EventEmitter();
    const startTime = Date.now();

    // Start streaming asynchronously
    this.streamRequest(messages, emitter, startTime).catch(error => {
      this.logger.error(`❌ Upstage stream error: ${error.message}`);
      emitter.emit('error', error);
    });

    return {
      emitter,
      modelUsed: 'upstage:solar-pro',
    };
  }

  private async streamRequest(
    messages: ChatMessage[],
    emitter: EventEmitter,
    startTime: number,
  ): Promise<void> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.MODEL,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'stream',
          timeout: 120000,
        }
      );

      let buffer = '';

      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              const elapsed = Date.now() - startTime;
              this.logger.log(`✅ Upstage stream completed: ${elapsed}ms`);
              emitter.emit('end');
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                emitter.emit('data', content);
              }
            } catch (e) {
              // Ignore JSON parsing failures
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
      throw error;
    }
  }
}
