import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface ServiceStatus {
  status: 'up' | 'down' | 'unknown';
  latency?: number;
  error?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    ollama: ServiceStatus;
    ocr: ServiceStatus;
    searxng: ServiceStatus;
  };
  uptime: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private startTime = Date.now();

  constructor(private configService: ConfigService) {}

  async check(): Promise<HealthStatus> {
    const [ollama, ocr, searxng] = await Promise.all([
      this.checkOllama(),
      this.checkOCR(),
      this.checkSearXNG(),
    ]);

    const services = { ollama, ocr, searxng };
    const allUp = Object.values(services).every(s => s.status === 'up');
    const allDown = Object.values(services).every(s => s.status === 'down');

    return {
      status: allUp ? 'healthy' : allDown ? 'unhealthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  async readiness(): Promise<{ ready: boolean; details: string }> {
    const health = await this.check();
    
    // Ollama is required
    const ready = health.services.ollama.status === 'up';
    
    return {
      ready,
      details: ready 
        ? 'AI server is ready to accept requests'
        : 'AI server is not ready - Ollama is down',
    };
  }

  private async checkOllama(): Promise<ServiceStatus> {
    // Check Pro model server (priority)
    const proUrl = this.configService.get('SAYKNOWAI_PRO_URL', '');
    const flashUrl = this.configService.get('SAYKNOWAI_FLASH_URL', '');
    const legacyUrl = this.configService.get('OLLAMA_URL', 'http://localhost:11434');
    
    // Prioritize new environment variables, fallback to legacy
    const urlToCheck = proUrl || flashUrl || legacyUrl;
    return this.checkService(`${urlToCheck}/api/tags`);
  }

  private async checkOCR(): Promise<ServiceStatus> {
    const url = this.configService.get('OCR_ENDPOINT', 'http://localhost:8000');
    return this.checkService(`${url}/health`);
  }

  private async checkSearXNG(): Promise<ServiceStatus> {
    const url = this.configService.get('SEARXNG_URL', 'http://localhost:8080');
    return this.checkService(`${url}/healthz`);
  }

  private async checkService(url: string): Promise<ServiceStatus> {
    const start = Date.now();
    try {
      await axios.get(url, { timeout: 5000 });
      return {
        status: 'up',
        latency: Date.now() - start,
      };
    } catch (error) {
      return {
        status: 'down',
        error: error.message,
      };
    }
  }
}
