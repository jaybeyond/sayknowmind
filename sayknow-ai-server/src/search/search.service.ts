import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private client: AxiosInstance;
  private isAvailable = false;

  constructor(private configService: ConfigService) {
    const searxngUrl = this.configService.get('SEARXNG_URL', 'http://localhost:8080');
    
    this.client = axios.create({
      baseURL: searxngUrl,
      timeout: 8000, // 8 seconds
      headers: {
        'X-Forwarded-For': '127.0.0.1',
        'X-Real-IP': '127.0.0.1',
      },
    });
  }

  async onModuleInit() {
    // Async check (prevent blocking server start)
    this.checkAvailability().catch(err => {
      this.logger.warn('Search availability check failed:', err.message);
    });
  }

  private async checkAvailability() {
    try {
      // SearXNG search test
      const response = await this.client.get('/search', {
        params: { q: 'test', format: 'json' },
        timeout: 10000,
      });
      
      if (response.data && response.data.results) {
        this.isAvailable = true;
        this.logger.log('✅ SearXNG is available');
      }
    } catch (error) {
      this.logger.warn('⚠️ SearXNG not available. Search will be disabled.');
      this.isAvailable = false;
    }
  }

  /**
   * Execute web search
   */
  async search(query: string, options?: {
    categories?: string[];
    language?: string;
    maxResults?: number;
  }): Promise<SearchResult[]> {
    if (!this.isAvailable) {
      // Check again
      await this.checkAvailability();
      if (!this.isAvailable) {
        this.logger.warn('Search skipped: SearXNG not available');
        return [];
      }
    }

    try {
      const response = await this.client.get('/search', {
        params: {
          q: query,
          format: 'json',
          language: options?.language || 'auto',
          categories: options?.categories?.join(',') || 'general',
        },
      });

      const results = response.data.results || [];
      const maxResults = options?.maxResults || 10;

      return results.slice(0, maxResults).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || r.snippet || '',
        engine: r.engine,
      }));
    } catch (error) {
      this.logger.error('Search error:', error.message);
      return [];
    }
  }

  /**
   * Check service status
   */
  isReady(): boolean {
    return this.isAvailable;
  }
}
