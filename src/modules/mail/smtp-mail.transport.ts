import { Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import type { MailMessage, MailTransport } from './mail.service';

/**
 * Envio real por SMTP (nodemailer), ativado por SMTP_URL. O corpo nunca vai
 * para o log: convites e redefinições de senha carregam tokens no link.
 * Falhas são registradas e não propagadas, para que "esqueci a senha" responda
 * igual exista ou não o usuário (sem enumeração de contas).
 */
export class SmtpMailTransport implements MailTransport {
  private readonly logger = new Logger('Mail');

  constructor(
    private readonly transporter: Pick<Transporter, 'sendMail'>,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    try {
      const info = await this.transporter.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
      this.logger.log({ to: message.to, subject: message.subject, messageId: info?.messageId }, 'E-mail enviado');
    } catch (err) {
      this.logger.error({ to: message.to, subject: message.subject, err: err instanceof Error ? err.message : String(err) }, 'Falha ao enviar e-mail');
    }
  }
}
