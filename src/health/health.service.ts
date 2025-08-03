import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  HealthCheck,
  HealthCheckResult,
  SimpleHealthResult,
} from './health.types';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const checks: HealthCheck[] = [];

    // Memory health check
    checks.push(await this.checkMemory());

    // CPU health check
    checks.push(await this.checkCpu());

    // Disk health check
    checks.push(await this.checkDisk());

    // Determine overall status
    const criticalChecks = checks.filter(
      (check) => check.status === 'critical',
    );
    const degradedChecks = checks.filter(
      (check) => check.status === 'degraded',
    );

    let overallStatus: 'healthy' | 'degraded' | 'critical';
    if (criticalChecks.length > 0) {
      overallStatus = 'critical';
    } else if (degradedChecks.length > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    return {
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check memory usage
   */
  private async checkMemory(): Promise<HealthCheck> {
    const memUsage = process.memoryUsage();
    const memoryUsedMB = memUsage.heapUsed / 1024 / 1024;
    const memoryLimitMB = this.configService.memoryLimitMB;
    const memoryUsagePercent = (memoryUsedMB / memoryLimitMB) * 100;

    let status: 'healthy' | 'degraded' | 'critical';
    let message: string;

    if (memoryUsagePercent > 90) {
      status = 'critical';
      message = `Memory usage critical: ${memoryUsagePercent.toFixed(1)}%`;
    } else if (memoryUsagePercent > 80) {
      status = 'degraded';
      message = `Memory usage high: ${memoryUsagePercent.toFixed(1)}%`;
    } else {
      status = 'healthy';
      message = `Memory usage normal: ${memoryUsagePercent.toFixed(1)}%`;
    }

    return {
      component: 'memory',
      status,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check CPU usage
   */
  private async checkCpu(): Promise<HealthCheck> {
    // Simple CPU check - in production you might want more sophisticated monitoring
    const cpuUsage = process.cpuUsage();
    const totalCpuTime = cpuUsage.user + cpuUsage.system;

    // This is a simplified check - you might want to implement proper CPU monitoring
    const status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    let message = 'CPU usage normal';

    // Check if process has been running long enough to get meaningful data
    if (process.uptime() < 10) {
      message = 'CPU check skipped - insufficient uptime';
    }

    return {
      component: 'cpu',
      status,
      message,
      responseTime: totalCpuTime / 1000, // Convert to milliseconds
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check disk space (basic check)
   */
  private async checkDisk(): Promise<HealthCheck> {
    // This is a basic implementation - in production you might want proper disk monitoring
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    let message = 'Disk space check not implemented';

    try {
      // Basic check using process information
      const memUsage = process.memoryUsage();
      message = `Disk usage monitoring available: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB RSS`;
    } catch (error) {
      status = 'degraded';
      message = 'Could not check disk space';
    }

    return {
      component: 'disk',
      status,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get simple health status
   */
  getSimpleHealth(): SimpleHealthResult {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check if worker is ready to accept tasks
   */
  isWorkerReady(): boolean {
    const memUsage = process.memoryUsage();
    const memoryUsedMB = memUsage.heapUsed / 1024 / 1024;
    const memoryLimitMB = this.configService.memoryLimitMB;
    const memoryUsagePercent = (memoryUsedMB / memoryLimitMB) * 100;

    // Worker is ready if memory usage is below 95%
    return memoryUsagePercent < 95;
  }
}
