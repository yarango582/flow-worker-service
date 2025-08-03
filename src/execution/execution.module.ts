import { Module } from '@nestjs/common';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ConfigModule } from '../config/config.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [ConfigModule, MessagingModule],
  controllers: [ExecutionController],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
