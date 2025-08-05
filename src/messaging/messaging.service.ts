import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as os from 'os';
import {
  RabbitMQClient,
  TaskMessage,
  ResultMessage,
  WorkerRegistrationMessage,
  WorkerHeartbeatMessage,
  SystemMetricsMessage,
  Queues,
} from 'flow-platform-node-core';
import { ConfigService } from '../config/config.service';

@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private rabbitmqClient: RabbitMQClient;
  private isInitialized = false;

  constructor(private configService: ConfigService) {
    this.rabbitmqClient = new RabbitMQClient({
      url: this.configService.rabbitmqUrl,
      exchange: this.configService.rabbitmqExchange,
      prefetch: this.configService.rabbitmqPrefetch,
      reconnectDelay: this.configService.reconnectDelay,
      maxReconnectAttempts: this.configService.maxReconnectAttempts,
    });

    this.setupEventListeners();
  }

  async onModuleInit() {
    try {
      await this.connect();
      await this.registerWorker();
      this.isInitialized = true;
      this.logger.log('✅ Messaging service initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize messaging service', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      this.isInitialized = false;
      await this.disconnect();
      this.logger.log('🛑 Messaging service shut down gracefully');
    } catch (error) {
      this.logger.error('❌ Error during messaging service shutdown', error);
    }
  }

  async connect(): Promise<void> {
    await this.rabbitmqClient.connect();
  }

  async disconnect(): Promise<void> {
    await this.rabbitmqClient.disconnect();
  }

  async registerWorker(): Promise<void> {
    const registrationMessage: WorkerRegistrationMessage = {
      id: `reg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      version: '1.0',
      workerId: this.configService.workerInstanceId,
      hostname: os.hostname(),
      capacity: {
        maxConcurrentFlows: this.configService.maxConcurrentFlows,
        maxConcurrentNodes: this.configService.maxConcurrentNodes,
        memoryLimitMB: this.configService.memoryLimitMB,
        cpuLimitCores: this.configService.cpuLimitCores,
      },
      supportedNodeTypes: this.configService.workerCapabilities,
      status: 'available',
      metadata: {
        version: '1.0',
        startedAt: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        region: process.env.AWS_REGION,
      },
    };

    await this.rabbitmqClient.publishWorkerRegistration(registrationMessage);
    this.logger.log(
      `🔗 Worker registered: ${this.configService.workerInstanceId}`,
    );
  }

  async sendHeartbeat(currentTasks: number = 0): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const heartbeatMessage: WorkerHeartbeatMessage = {
      id: `heartbeat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      version: '1.0',
      workerId: this.configService.workerInstanceId,
      status: 'healthy',
      currentLoad: {
        activeFlows: currentTasks,
        activeNodes: currentTasks,
        memoryUsagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        cpuUsagePercent: (cpuUsage.user + cpuUsage.system) / 10000,
        queuedTasks: 0,
      },
      lastHeartbeat: new Date().toISOString(),
      uptime: process.uptime(),
    };

    try {
      await this.rabbitmqClient.publishWorkerHeartbeat(heartbeatMessage);
      this.logger.debug(
        `💓 Heartbeat sent: ${currentTasks}/${this.configService.maxConcurrentTasks} tasks`,
      );
    } catch (error) {
      this.logger.error('❌ Failed to send heartbeat', error);
    }
  }

  async sendTaskResult(
    result: Omit<ResultMessage, 'id' | 'timestamp' | 'version'>,
  ): Promise<void> {
    const resultMessage: ResultMessage = {
      id: `result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      version: '1.0',
      ...result,
    };

    try {
      await this.rabbitmqClient.publishResult(resultMessage);
      this.logger.debug(
        `📤 Task result sent: ${result.taskId} - ${result.status}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to send task result for ${result.taskId}`,
        error,
      );
      throw error;
    }
  }

  async sendSystemMetrics(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    const memUsage = process.memoryUsage();

    const metricsMessage: SystemMetricsMessage = {
      id: `metrics-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      version: '1.0',
      serviceId: this.configService.workerInstanceId,
      serviceType: 'worker',
      metrics: {
        uptime: process.uptime(),
        memoryUsage: memUsage.heapUsed / 1024 / 1024, // MB
        cpuUsage: process.cpuUsage().user + process.cpuUsage().system,
        activeTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
      },
      tags: {
        worker_id: this.configService.workerInstanceId,
        environment: process.env.NODE_ENV || 'development',
      },
    };

    try {
      await this.rabbitmqClient.publishSystemMetrics(metricsMessage);
      this.logger.debug('📊 System metrics sent');
    } catch (error) {
      this.logger.error('❌ Failed to send system metrics', error);
    }
  }

  async startTaskConsumer(
    taskHandler: (task: TaskMessage) => Promise<void>,
  ): Promise<void> {
    try {
      // Start consumers for all priority queues
      // High priority tasks are processed first
      await this.rabbitmqClient.consume<TaskMessage>(
        Queues.TASKS_HIGH,
        async (task) => {
          this.logger.debug(`🔴 Processing HIGH priority task: ${task.id}`);
          await taskHandler(task);
        },
        {
          noAck: false,
          prefetch: Math.ceil(this.configService.rabbitmqPrefetch / 3), // Allocate 1/3 for high priority
        },
      );

      // Normal priority tasks
      await this.rabbitmqClient.consume<TaskMessage>(
        Queues.TASKS_NORMAL,
        async (task) => {
          this.logger.debug(`🟡 Processing NORMAL priority task: ${task.id}`);
          await taskHandler(task);
        },
        {
          noAck: false,
          prefetch: Math.ceil(this.configService.rabbitmqPrefetch / 2), // Allocate 1/2 for normal priority
        },
      );

      // Low priority tasks
      await this.rabbitmqClient.consume<TaskMessage>(
        Queues.TASKS_LOW,
        async (task) => {
          this.logger.debug(`🟢 Processing LOW priority task: ${task.id}`);
          await taskHandler(task);
        },
        {
          noAck: false,
          prefetch: Math.ceil(this.configService.rabbitmqPrefetch / 6), // Allocate 1/6 for low priority
        },
      );

      this.logger.log(`🎯 Started consuming tasks from ALL priority queues (HIGH, NORMAL, LOW)`);
    } catch (error) {
      this.logger.error('❌ Failed to start task consumers', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.rabbitmqClient.isConnected();
  }

  getClient(): RabbitMQClient {
    return this.rabbitmqClient;
  }

  private setupEventListeners(): void {
    this.rabbitmqClient.on('connected', () => {
      this.logger.log('🔗 Connected to RabbitMQ');
    });

    this.rabbitmqClient.on('disconnected', () => {
      this.logger.warn('🔌 Disconnected from RabbitMQ');
    });

    this.rabbitmqClient.on('error', (error) => {
      this.logger.error('🔥 RabbitMQ error:', error);
    });

    this.rabbitmqClient.on('maxReconnectAttemptsReached', () => {
      this.logger.error('💀 Max reconnection attempts reached');
    });

    this.rabbitmqClient.on('messageError', (error) => {
      this.logger.error('📨 Message processing error:', error);
    });
  }
}
