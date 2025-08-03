import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
  constructor(private configService: NestConfigService) {}

  get port(): number {
    return this.configService.get<number>('PORT', 3003);
  }

  get rabbitmqUrl(): string {
    return this.configService.get<string>(
      'RABBITMQ_URL',
      'amqp://user:password@localhost:5672',
    );
  }

  get rabbitmqExchange(): string {
    return this.configService.get<string>('RABBITMQ_EXCHANGE', 'flow-platform');
  }

  get rabbitmqTaskQueue(): string {
    return this.configService.get<string>('RABBITMQ_TASK_QUEUE', 'task-queue');
  }

  get rabbitmqResultQueue(): string {
    return this.configService.get<string>(
      'RABBITMQ_RESULT_QUEUE',
      'result-queue',
    );
  }

  get rabbitmqPrefetch(): number {
    return this.configService.get<number>('RABBITMQ_PREFETCH', 10);
  }

  get workerInstanceId(): string {
    return this.configService.get<string>(
      'WORKER_INSTANCE_ID',
      `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    );
  }

  get workerCapabilities(): string[] {
    const capabilities = this.configService.get<string>(
      'WORKER_CAPABILITIES',
      'data-filter,mongodb-operations,postgresql-query,field-mapper',
    );
    return capabilities.split(',').map((cap) => cap.trim());
  }

  get maxConcurrentTasks(): number {
    return this.configService.get<number>('MAX_CONCURRENT_TASKS', 5);
  }

  get healthCheckInterval(): number {
    return this.configService.get<number>('HEALTH_CHECK_INTERVAL', 30000);
  }

  get orchestratorUrl(): string {
    return this.configService.get<string>(
      'ORCHESTRATOR_URL',
      'http://localhost:3001',
    );
  }

  get logLevel(): string {
    return this.configService.get<string>('LOG_LEVEL', 'info');
  }

  get memoryLimitMB(): number {
    return this.configService.get<number>('MEMORY_LIMIT_MB', 512);
  }

  get cpuLimitCores(): number {
    return this.configService.get<number>('CPU_LIMIT_CORES', 2);
  }

  get maxConcurrentFlows(): number {
    return this.configService.get<number>(
      'MAX_CONCURRENT_FLOWS',
      this.maxConcurrentTasks,
    );
  }

  get maxConcurrentNodes(): number {
    return this.configService.get<number>(
      'MAX_CONCURRENT_NODES',
      this.maxConcurrentTasks * 2,
    );
  }
}
