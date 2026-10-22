import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config.service';
import type { Env } from '../../config/env';
import { createMailTransport } from './mail-transport.factory';
import { LogMailTransport } from './mail.service';
import { SmtpMailTransport } from './smtp-mail.transport';

const configWith = (env: Partial<Env>) =>
  ({
    get: (key: keyof Env) => env[key],
    get isProduction() {
      return env.NODE_ENV === 'production';
    },
  }) as unknown as AppConfig;

const message = {
  to: 'ana@exemplo.com',
  subject: 'RotaGest — redefinição de senha',
  text: 'Acesse: https://app/reset?token=segredo',
  actionUrl: 'https://app/reset?token=segredo',
};

describe('Transporte de e-mail', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sem SMTP_URL usa o transporte de log', () => {
    const smtp = jest.fn();
    const t = createMailTransport(configWith({ NODE_ENV: 'development' }), smtp);
    expect(t).toBeInstanceOf(LogMailTransport);
    expect(smtp).not.toHaveBeenCalled();
  });

  it('em produção sem SMTP_URL avisa no log sem derrubar a aplicação', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const t = createMailTransport(configWith({ NODE_ENV: 'production' }));
    expect(t).toBeInstanceOf(LogMailTransport);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SMTP_URL não configurado'));
  });

  it('com SMTP_URL usa SMTP com o remetente configurado', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'abc' });
    const smtp = jest.fn().mockReturnValue({ sendMail });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const t = createMailTransport(
      configWith({ NODE_ENV: 'production', SMTP_URL: 'smtps://u:p@smtp.exemplo.com:465', MAIL_FROM: 'RotaGest <x@rotagest.com.br>' }),
      smtp as never,
    );
    expect(t).toBeInstanceOf(SmtpMailTransport);
    expect(smtp).toHaveBeenCalledWith('smtps://u:p@smtp.exemplo.com:465');
    await t.send(message);
    expect(sendMail).toHaveBeenCalledWith({ from: 'RotaGest <x@rotagest.com.br>', to: message.to, subject: message.subject, text: message.text });
  });

  it('nunca registra o corpo nem o link no log, nem em caso de falha', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const ok = new SmtpMailTransport({ sendMail: jest.fn().mockResolvedValue({ messageId: '1' }) } as never, 'x@y.com');
    const failing = new SmtpMailTransport({ sendMail: jest.fn().mockRejectedValue(new Error('conexão recusada')) } as never, 'x@y.com');
    await ok.send(message);
    await expect(failing.send(message)).resolves.toBeUndefined();
    const logged = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    expect(error).toHaveBeenCalled();
    expect(logged).not.toContain('segredo');
  });
});
