import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;
  private connectionAttempts = 0;
  private readonly maxConnectionAttempts = 3;
  private lastErrorLog = 0;
  private readonly errorLogInterval = 60000; // Log errors only once per minute

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    
    if (!redisUrl) {
      this.logger.warn('⚠️ REDIS_URL not configured - Memory system disabled (AI will work without memory)');
      return;
    }

    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        retryStrategy: (times) => {
          this.connectionAttempts = times;
          if (times > this.maxConnectionAttempts) {
            this.logger.warn(`⚠️ Redis connection failed after ${this.maxConnectionAttempts} attempts - Memory system disabled`);
            return null; // Stop reconnection
          }
          return Math.min(times * 1000, 5000); // Wait up to 5 seconds
        },
        reconnectOnError: () => false, // Disable auto-reconnect on error
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.connectionAttempts = 0;
        this.logger.log('✅ Redis connected');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        // Log errors only once per minute
        const now = Date.now();
        if (now - this.lastErrorLog > this.errorLogInterval) {
          this.logger.error('❌ Redis error:', err.message);
          this.lastErrorLog = now;
        }
      });

      this.client.on('close', () => {
        if (this.isConnected) {
          this.isConnected = false;
          this.logger.warn('⚠️ Redis connection closed');
        }
      });

      await this.client.connect();
    } catch (error) {
      this.logger.error('❌ Failed to connect to Redis:', error.message);
      this.logger.warn('⚠️ AI server will continue without memory system');
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }

  isReady(): boolean {
    return this.isConnected && this.client !== null;
  }

  getClient(): Redis | null {
    return this.client;
  }

  // Basic CRUD methods
  async get(key: string): Promise<string | null> {
    if (!this.isReady()) return null;
    return this.client!.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isReady()) return;
    if (ttlSeconds) {
      await this.client!.setex(key, ttlSeconds, value);
    } else {
      await this.client!.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isReady()) return;
    await this.client!.del(key);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isReady()) return false;
    const result = await this.client!.exists(key);
    return result === 1;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (!this.isReady()) return;
    await this.client!.expire(key, ttlSeconds);
  }

  // JSON helpers
  async getJson<T>(key: string): Promise<T | null> {
    const data = await this.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  // List methods (for conversation history)
  async lpush(key: string, value: string): Promise<void> {
    if (!this.isReady()) return;
    await this.client!.lpush(key, value);
  }

  async rpush(key: string, value: string): Promise<void> {
    if (!this.isReady()) return;
    await this.client!.rpush(key, value);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.isReady()) return [];
    return this.client!.lrange(key, start, stop);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    if (!this.isReady()) return;
    await this.client!.ltrim(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    if (!this.isReady()) return 0;
    return this.client!.llen(key);
  }

  // SCAN method (for pattern matching key lookup)
  async scanKeys(pattern: string): Promise<string[]> {
    if (!this.isReady()) return [];
    
    const keys: string[] = [];
    let cursor = '0';
    
    try {
      do {
        const [nextCursor, foundKeys] = await this.client!.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        keys.push(...foundKeys);
      } while (cursor !== '0');
    } catch (error) {
      this.logger.error('Error scanning keys:', error);
    }
    
    return keys;
  }

  // Delete multiple keys (for GDPR deletion)
  async delMultiple(keys: string[]): Promise<void> {
    if (!this.isReady() || keys.length === 0) return;
    await this.client!.del(...keys);
  }
}
