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

// NVIDIA NIM model list
export const NVIDIA_MODELS = {
  GLM_47: 'z-ai/glm4_7',           // GLM-4.7 coding/reasoning specialized
  LLAMA_31_70B: 'meta/llama-3.1-70b-instruct',  // Llama 3.1 70B
  LLAMA_31_8B: 'meta/llama-3.1-8b-instruct',    // Llama 3.1 8B (fast)
  DEEPSEEK_R1: 'deepseek-ai/deepseek-r1',       // DeepSeek R1 reasoning
  MISTRAL_7B: 'mistralai/mistral-7b-instruct-v0.3',  // Mistral 7B
};

@Injectable()
export class NvidiaService implements OnModuleInit {
  private readonly logger = new Logger(NvidiaService.name);
  private client: AxiosInstance;
  private apiKey: string;
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('NVIDIA_API_KEY', '');
    
    this.client = axios.create({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async onModuleInit() {
    if (this.apiKey) {
      this.isConfigured = true;
      this.logger.log('✅ NVIDIA NIM configured');
      this.logger.log(`   Available models: GLM-4.7, Llama 3.1 70B/8B, DeepSeek R1, Mistral 7B`);
      this.logger.log(`   Rate limit: 40 RPM`);
    } else {
      this.logger.warn('⚠️ NVIDIA API key not configured');
    }
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  /**
   * NVIDIA NIM chat (non-streaming)
   */
  async chat(messages: ChatMessage[], model: string = NVIDIA_MODELS.GLM_47): Promise<ChatResult> {
    if (!this.isConfigured) {
      throw new Error('NVIDIA NIM not configured');
    }

    const startTime = Date.now();
    this.logger.log(`🟢 NVIDIA NIM request: model=${model}`);

    try {
      const response = await this.client.post('/chat/completions', {
        model,
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        temperature: 0.6,
        max_tokens: 1024,
        stream: false,
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      const content = response.data.choices?.[0]?.message?.content || '';
      const tokensUsed = response.data.usage?.total_tokens || 0;
      const elapsed = Date.now() - startTime;

      this.logger.log(`✅ NVIDIA NIM responded: ${elapsed}ms, tokens=${tokensUsed}, model=${model}`);

      return {
        content,
        tokensUsed,
        modelUsed: `nvidia:${model}`,
        fallbackUsed: false,
      };
    } catch (error) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error?.message || error.message;
      
      this.logger.error(`❌ NVIDIA NIM error: ${status} - ${errorMsg}`);
      
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
   * NVIDIA NIM streaming chat
   */
  async chatStream(messages: ChatMessage[], model: string = NVIDIA_MODELS.GLM_47): Promise<{
    emitter: EventEmitter;
    modelUsed: string;
  }> {
    if (!this.isConfigured) {
      throw new Error('NVIDIA NIM not configured');
    }

    const emitter = new EventEmitter();
    const startTime = Date.now();
    
    this.logger.log(`🟢 NVIDIA NIM stream request: model=${model}`);

    try {
      const response = await this.client.post('/chat/completions', {
        model,
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        temperature: 0.6,
        max_tokens: 1024,
        stream: true,
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        responseType: 'stream',
      });

      let fullContent = '';
      let streamEnded = false;

      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              if (streamEnded) return;
              streamEnded = true;
              
              const elapsed = Date.now() - startTime;
              this.logger.log(`✅ NVIDIA NIM stream completed: ${elapsed}ms, model=${model}`);
              
              // Empty response treated as error → triggers fallback
              if (!fullContent || fullContent.trim().length === 0) {
                this.logger.warn(`⚠️ NVIDIA NIM returned empty response: model=${model}`);
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
        this.logger.error(`❌ NVIDIA NIM stream error: ${error.message}`);
        emitter.emit('error', error);
      });

      response.data.on('end', () => {
        // Already handled in [DONE], skip
        if (streamEnded) return;
        streamEnded = true;
        
        // Stream ended without [DONE] and response is empty → error
        if (!fullContent || fullContent.trim().length === 0) {
          this.logger.warn(`⚠️ NVIDIA NIM stream ended without content: model=${model}`);
          emitter.emit('error', new Error(`Empty response from ${model}`));
          return;
        }
        
        emitter.emit('end');
      });

      return {
        emitter,
        modelUsed: `nvidia:${model}`,
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
}
