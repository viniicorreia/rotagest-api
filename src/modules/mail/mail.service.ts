import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Link de ação (convite, redefinição). */
  actionUrl?: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * Transporte padrão enquanto não há SMTP configurado (Fase 6): registra o
 * envio no log. O link só é registrado fora de produção, para não vazar tokens.
 */
@Injectable()
export class LogMailTransport implements MailTransport {
  private readonly logger = new Logger('Mail');

  constructor(private readonly config: AppConfig) {}

  async send(message: MailMessage): Promise<void> {
    if (this.config.isProduction) {
      this.logger.warn({ to: message.to, subject: message.subject }, 'SMTP não configurado: e-mail não enviado');
      return;
    }
    this.logger.log({ to: message.to, subject: message.subject, actionUrl: message.actionUrl }, 'E-mail (modo log)');
  }
}

@Injectable()
export class MailService {
  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {}

  send(message: MailMessage): Promise<void> {
    return this.transport.send(message);
  }
}
