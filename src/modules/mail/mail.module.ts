import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { createMailTransport } from './mail-transport.factory';
import { MAIL_TRANSPORT, MailService } from './mail.service';

@Global()
@Module({
  providers: [MailService, { provide: MAIL_TRANSPORT, inject: [AppConfig], useFactory: (config: AppConfig) => createMailTransport(config) }],
  exports: [MailService],
})
export class MailModule {}
