import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { AppConfig } from '../../config/app-config.service';
import { LogMailTransport, type MailTransport } from './mail.service';
import { SmtpMailTransport } from './smtp-mail.transport';

/**
 * Escolhe o transporte de e-mail: SMTP quando SMTP_URL está definido
 * (ex.: smtps://usuario:senha@smtp.exemplo.com:465); senão, só log.
 * Em produção sem SMTP a API sobe, mas avisa que nenhum e-mail sairá.
 */
export function createMailTransport(config: AppConfig, smtpFactory: typeof createTransport = createTransport): MailTransport {
  const url = config.get('SMTP_URL');
  if (url) return new SmtpMailTransport(smtpFactory(url), config.get('MAIL_FROM'));
  if (config.isProduction) {
    new Logger('Mail').warn('SMTP_URL não configurado: convites e redefinições de senha NÃO serão enviados por e-mail');
  }
  return new LogMailTransport(config);
}
