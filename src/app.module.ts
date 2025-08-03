import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ExecutionModule } from './execution/execution.module';
import { MessagingModule } from './messaging/messaging.module';
import { HealthModule } from './health/health.module';
import { ConfigModule } from './config/config.module';

@Module({
  imports: [ExecutionModule, MessagingModule, HealthModule, ConfigModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
