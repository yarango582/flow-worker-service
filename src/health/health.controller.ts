import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import {
  HealthCheckResult,
  SimpleHealthResult,
  ReadinessResult,
} from './health.types';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): SimpleHealthResult {
    return this.healthService.getSimpleHealth();
  }

  @Get('detailed')
  async getDetailedHealth(): Promise<HealthCheckResult> {
    return await this.healthService.performHealthCheck();
  }

  @Get('ready')
  getReadiness(): ReadinessResult {
    const isReady = this.healthService.isWorkerReady();
    return {
      ready: isReady,
      timestamp: new Date().toISOString(),
    };
  }
}
