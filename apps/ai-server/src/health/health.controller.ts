import { Controller, Get } from '@nestjs/common';
import { HealthService, HealthStatus } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(): Promise<HealthStatus> {
    return this.healthService.check();
  }

  @Get('ready')
  async ready(): Promise<{ ready: boolean; details: string }> {
    return this.healthService.readiness();
  }

  @Get('live')
  async live(): Promise<{ status: string; timestamp: string }> {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
