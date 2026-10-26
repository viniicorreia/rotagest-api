import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { createStorageDriver, STORAGE_DRIVER, StorageService } from './storage.service';

@Module({
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    StorageService,
    { provide: STORAGE_DRIVER, inject: [AppConfig], useFactory: (config: AppConfig) => createStorageDriver(config) },
  ],
})
export class AttachmentsModule {}
