import { Injectable, Logger } from '@nestjs/common';
import { NodeRegistry } from 'flow-platform-node-core';
import { INode } from 'flow-platform-node-core';
import { ExecutionContext } from 'flow-platform-node-core';
import { TaskMessage, ResultMessage } from 'flow-platform-node-core';
import {
  PostgreSQLQueryNode,
  MongoDBOperationsNode,
  DataFilterNode,
  FieldMapperNode,
} from 'flow-platform-node-core';
import { ConfigService } from '../config/config.service';
import { MessagingService } from '../messaging/messaging.service';

interface TaskExecution {
  taskId: string;
  status: 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  node?: INode;
  context?: ExecutionContext;
}

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);
  private readonly nodeRegistry: NodeRegistry;
  private readonly activeTasks = new Map<string, TaskExecution>();
  private taskStats = {
    completed: 0,
    failed: 0,
    totalExecutionTime: 0,
  };

  constructor(
    private configService: ConfigService,
    private messagingService: MessagingService,
  ) {
    this.nodeRegistry = new NodeRegistry();
    this.initializeNodeRegistry();
  }

  /**
   * Initialize and register available nodes
   */
  private initializeNodeRegistry(): void {
    try {
      this.logger.log('🔧 Initializing node registry...');

      // Register available node classes
      this.nodeRegistry.register(PostgreSQLQueryNode, 'postgresql-query');
      this.nodeRegistry.register(MongoDBOperationsNode, 'mongodb-operations');
      this.nodeRegistry.register(DataFilterNode, 'data-filter');
      this.nodeRegistry.register(FieldMapperNode, 'field-mapper');

      const availableTypes = this.nodeRegistry.getAvailableTypes();
      this.logger.log(
        `🔧 Node registry initialized with ${availableTypes.length} node types: ${availableTypes.join(', ')}`,
      );
    } catch (error) {
      this.logger.error('❌ Failed to initialize node registry', error);
      throw error;
    }
  }

  /**
   * Execute a task from the message queue
   */
  async executeTask(taskMessage: TaskMessage): Promise<void> {
    const startTime = new Date();
    const taskExecution: TaskExecution = {
      taskId: taskMessage.id,
      status: 'running',
      startTime,
    };

    this.activeTasks.set(taskMessage.id, taskExecution);

    try {
      this.logger.log(
        `🚀 Starting task execution: ${taskMessage.nodeType} (${taskMessage.id})`,
      );

      // Create execution context
      const context: ExecutionContext = {
        flowId: taskMessage.flowId,
        executionId: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nodeId: taskMessage.nodeId,
        logger: this.logger,
        config: {
          ...taskMessage.configuration,
          workerId: this.configService.workerInstanceId,
          startedAt: startTime.toISOString(),
        },
      };

      // Get node instance
      const node = this.nodeRegistry.create(
        taskMessage.nodeType,
        taskMessage.configuration,
      );
      if (!node) {
        throw new Error(
          `Node type '${taskMessage.nodeType}' not supported by this worker`,
        );
      }

      taskExecution.node = node;
      taskExecution.context = context;

      // Execute the node
      const result = await this.executeNodeWithTimeout(
        node,
        context,
        taskMessage,
      );

      // Update task execution
      const endTime = new Date();
      taskExecution.status = 'completed';
      taskExecution.endTime = endTime;

      // Calculate execution metrics
      const duration = endTime.getTime() - startTime.getTime();
      this.taskStats.completed++;
      this.taskStats.totalExecutionTime += duration;

      // Send result back to orchestrator
      await this.sendTaskResult({
        taskId: taskMessage.id,
        workerId: this.configService.workerInstanceId,
        status: 'success',
        outputs: result,
        metadata: {
          startedAt: startTime.toISOString(),
          completedAt: endTime.toISOString(),
          duration,
          memoryUsed: this.getMemoryUsage(),
          cpuUsed: this.getCpuUsage(),
          recordsProcessed: result?.recordsProcessed || 0,
        },
      });

      this.logger.log(
        `✅ Task completed successfully: ${taskMessage.id} (${duration}ms)`,
      );
    } catch (error) {
      await this.handleTaskError(taskMessage, taskExecution, error);
    } finally {
      // Clean up
      this.activeTasks.delete(taskMessage.id);
    }
  }

  /**
   * Execute node with timeout protection
   */
  private async executeNodeWithTimeout(
    node: INode,
    context: ExecutionContext,
    taskMessage: TaskMessage,
  ): Promise<any> {
    const timeoutMs = taskMessage.timeout?.executionTimeoutMs || 300000; // 5 minutes default

    return new Promise(async (resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Task execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        const result = await node.execute(taskMessage.inputs, context);
        clearTimeout(timeoutHandle);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutHandle);
        reject(error);
      }
    });
  }

  /**
   * Handle task execution errors
   */
  private async handleTaskError(
    taskMessage: TaskMessage,
    taskExecution: TaskExecution,
    error: any,
  ): Promise<void> {
    const endTime = new Date();
    taskExecution.status = 'failed';
    taskExecution.endTime = endTime;
    this.taskStats.failed++;

    const duration = endTime.getTime() - taskExecution.startTime.getTime();
    const isRetryable = this.isErrorRetryable(error);

    this.logger.error(
      `❌ Task failed: ${taskMessage.id} - ${error.message}`,
      error.stack,
    );

    try {
      await this.sendTaskResult({
        taskId: taskMessage.id,
        workerId: this.configService.workerInstanceId,
        status: 'failed',
        metadata: {
          startedAt: taskExecution.startTime.toISOString(),
          completedAt: endTime.toISOString(),
          duration,
          memoryUsed: this.getMemoryUsage(),
          cpuUsed: this.getCpuUsage(),
        },
        error: {
          code: error.code || 'EXECUTION_ERROR',
          message: error.message,
          stack: error.stack,
          nodeType: taskMessage.nodeType,
          retryable: isRetryable,
        },
      });
    } catch (resultError) {
      this.logger.error('❌ Failed to send error result:', resultError);
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isErrorRetryable(error: any): boolean {
    // Network errors, timeouts, and temporary failures are retryable
    const retryableErrors = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'TIMEOUT',
      'CONNECTION_ERROR',
      'TEMPORARY_FAILURE',
    ];

    return retryableErrors.some(
      (code) =>
        error.code === code ||
        error.message?.includes(code) ||
        error.message?.toLowerCase().includes('timeout') ||
        error.message?.toLowerCase().includes('connection'),
    );
  }

  /**
   * Send task result to orchestrator
   */
  private async sendTaskResult(
    result: Omit<ResultMessage, 'id' | 'timestamp' | 'version'>,
  ): Promise<void> {
    await this.messagingService.sendTaskResult(result);
  }

  /**
   * Get current active tasks count
   */
  getActiveTasksCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Get task execution statistics
   */
  getTaskStats() {
    const avgExecutionTime =
      this.taskStats.completed > 0
        ? this.taskStats.totalExecutionTime / this.taskStats.completed
        : 0;

    return {
      active: this.activeTasks.size,
      completed: this.taskStats.completed,
      failed: this.taskStats.failed,
      successRate:
        this.taskStats.completed + this.taskStats.failed > 0
          ? (this.taskStats.completed /
              (this.taskStats.completed + this.taskStats.failed)) *
            100
          : 100,
      averageExecutionTime: Math.round(avgExecutionTime),
      activeTasks: Array.from(this.activeTasks.values()).map((task) => ({
        taskId: task.taskId,
        status: task.status,
        startTime: task.startTime,
        nodeType: task.node?.constructor.name,
      })),
    };
  }

  /**
   * Get supported node types
   */
  getSupportedNodeTypes(): string[] {
    return this.nodeRegistry.getAvailableTypes();
  }

  /**
   * Check if worker can handle a specific node type
   */
  canHandleNodeType(nodeType: string): boolean {
    return this.nodeRegistry.getAvailableTypes().includes(nodeType);
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    return process.memoryUsage().heapUsed / 1024 / 1024; // MB
  }

  /**
   * Get current CPU usage
   */
  private getCpuUsage(): number {
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1000; // microseconds to milliseconds
  }

  /**
   * Graceful shutdown - wait for active tasks to complete
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    if (this.activeTasks.size === 0) {
      this.logger.log('🛑 No active tasks, shutting down immediately');
      return;
    }

    this.logger.log(
      `🛑 Waiting for ${this.activeTasks.size} active tasks to complete...`,
    );

    const shutdownPromise = new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.activeTasks.size === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        this.logger.warn(
          `⚠️ Shutdown timeout reached, ${this.activeTasks.size} tasks still active`,
        );
        resolve();
      }, timeoutMs);
    });

    await Promise.race([shutdownPromise, timeoutPromise]);
    this.logger.log('🛑 Execution service shutdown complete');
  }
}
