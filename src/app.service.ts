import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ExecutionService } from './execution/execution.service';
import { MessagingService } from './messaging/messaging.service';
import { HealthService } from './health/health.service';
import { ConfigService } from './config/config.service';
import { TaskMessage } from '@flow-platform/node-core';

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppService.name);
  private heartbeatInterval: NodeJS.Timeout;
  private metricsInterval: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(
    private executionService: ExecutionService,
    private messagingService: MessagingService,
    private healthService: HealthService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      this.logger.log('🚀 Starting Worker Service...');

      // Start consuming tasks
      await this.startTaskConsumer();

      // Start periodic heartbeat
      this.startHeartbeat();

      // Start metrics reporting
      this.startMetricsReporting();

      this.logger.log('✅ Worker Service started successfully');
      this.logger.log(`🏷️ Worker ID: ${this.configService.workerInstanceId}`);
      this.logger.log(
        `🛠️ Capabilities: ${this.configService.workerCapabilities.join(', ')}`,
      );
      this.logger.log(
        `⚡ Max concurrent tasks: ${this.configService.maxConcurrentTasks}`,
      );
    } catch (error) {
      this.logger.error('❌ Failed to start Worker Service', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('🛑 Shutting down Worker Service...');
    this.isShuttingDown = true;

    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Wait for active tasks to complete
    await this.executionService.shutdown(30000);

    this.logger.log('🛑 Worker Service shut down gracefully');
  }

  /**
   * Start consuming tasks from the message queue
   */
  private async startTaskConsumer(): Promise<void> {
    await this.messagingService.startTaskConsumer(
      async (taskMessage: TaskMessage) => {
        if (this.isShuttingDown) {
          this.logger.warn(
            `⚠️ Rejecting task ${taskMessage.id} - Worker is shutting down`,
          );
          return;
        }

        // Check if we can handle this node type
        if (!this.executionService.canHandleNodeType(taskMessage.nodeType)) {
          this.logger.warn(
            `⚠️ Rejecting task ${taskMessage.id} - Unsupported node type: ${taskMessage.nodeType}`,
          );
          return;
        }

        // Check capacity
        if (
          this.executionService.getActiveTasksCount() >=
          this.configService.maxConcurrentTasks
        ) {
          this.logger.warn(
            `⚠️ Rejecting task ${taskMessage.id} - At maximum capacity`,
          );
          return;
        }

        // Execute the task
        await this.executionService.executeTask(taskMessage);
      },
    );
  }

  /**
   * Start periodic heartbeat to orchestrator
   */
  private startHeartbeat(): void {
    const sendHeartbeat = async () => {
      if (this.isShuttingDown) return;

      try {
        const currentTasks = this.executionService.getActiveTasksCount();
        await this.messagingService.sendHeartbeat(currentTasks);
      } catch (error) {
        this.logger.error('❌ Failed to send heartbeat', error);
      }
    };

    // Send initial heartbeat
    sendHeartbeat();

    // Schedule periodic heartbeats
    this.heartbeatInterval = setInterval(
      sendHeartbeat,
      this.configService.healthCheckInterval,
    );

    this.logger.debug(
      `💓 Heartbeat started (interval: ${this.configService.healthCheckInterval}ms)`,
    );
  }

  /**
   * Start periodic metrics reporting
   */
  private startMetricsReporting(): void {
    const sendMetrics = async () => {
      if (this.isShuttingDown) return;

      try {
        await this.messagingService.sendSystemMetrics();
      } catch (error) {
        this.logger.error('❌ Failed to send metrics', error);
      }
    };

    // Send initial metrics
    setTimeout(sendMetrics, 5000); // Delay initial metrics

    // Schedule periodic metrics
    this.metricsInterval = setInterval(
      sendMetrics,
      this.configService.healthCheckInterval * 2, // Less frequent than heartbeat
    );

    this.logger.debug(`📊 Metrics reporting started`);
  }

  /**
   * Get service status
   */
  getStatus() {
    const stats = this.executionService.getTaskStats();

    return {
      service: 'worker-service',
      version: '1.0.0',
      workerId: this.configService.workerInstanceId,
      status: this.isShuttingDown
        ? 'shutting_down'
        : stats.active > 0
          ? 'busy'
          : 'available',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      messaging: {
        connected: this.messagingService.isConnected(),
      },
      execution: stats,
      capabilities: this.configService.workerCapabilities,
      limits: {
        maxConcurrentTasks: this.configService.maxConcurrentTasks,
        memoryLimitMB: this.configService.memoryLimitMB,
        cpuLimitCores: this.configService.cpuLimitCores,
      },
      timestamp: new Date().toISOString(),
    };
  }

  getHello(): string {
    return `Worker Service (${this.configService.workerInstanceId}) - Ready to process flows!`;
  }
}
