import { Controller, Get, Logger } from '@nestjs/common';
import { ExecutionService } from './execution.service';

@Controller('execution')
export class ExecutionController {
  private readonly logger = new Logger(ExecutionController.name);

  constructor(private executionService: ExecutionService) {}

  /**
   * Get execution statistics
   */
  @Get('stats')
  getExecutionStats() {
    return {
      timestamp: new Date().toISOString(),
      ...this.executionService.getTaskStats(),
    };
  }

  /**
   * Get supported node types
   */
  @Get('node-types')
  getSupportedNodeTypes() {
    return {
      supportedNodeTypes: this.executionService.getSupportedNodeTypes(),
      count: this.executionService.getSupportedNodeTypes().length,
    };
  }

  /**
   * Get current worker status
   */
  @Get('status')
  getWorkerStatus() {
    const stats = this.executionService.getTaskStats();

    return {
      status: stats.active > 0 ? 'busy' : 'available',
      activeTasks: stats.active,
      completedTasks: stats.completed,
      failedTasks: stats.failed,
      successRate: stats.successRate,
      averageExecutionTime: stats.averageExecutionTime,
      supportedNodeTypes: this.executionService.getSupportedNodeTypes(),
      timestamp: new Date().toISOString(),
    };
  }
}
