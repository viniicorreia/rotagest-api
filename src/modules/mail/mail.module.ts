import { Global, Module } from '@nestjs/common';
import { LogMailTransport, MAIL_TRANSPORT, MailService } from './mail.service';

@Global()
@Module({
  providers: [MailService, { provide: MAIL_TRANSPORT, useClass: LogMailTransport }],
  exports: [MailService],
})
export class MailModule {}
