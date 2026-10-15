import { ArgumentsHost, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => ({ id: 'req-1' }) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as Record<string, unknown> };
}

describe('AllExceptionsFilter', () => {
  it('converte violação de unicidade em 409 sem detalhes do banco', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`companyId`,`plate`)', {
      code: 'P2002',
      clientVersion: 'x',
      meta: { target: ['companyId', 'plate'] },
    });
    const { status, body } = run(err);
    expect(status).toBe(409);
    expect(JSON.stringify(body)).not.toMatch(/companyId|plate|constraint/);
    expect(body.requestId).toBe('req-1');
  });

  it('preserva código de domínio das HttpExceptions', () => {
    const { status, body } = run(new ForbiddenException({ message: 'Sem acesso', code: 'COMPANY_ACCESS_DENIED' }));
    expect(status).toBe(403);
    expect(body).toMatchObject({ code: 'COMPANY_ACCESS_DENIED', message: 'Sem acesso' });
  });

  it('erros inesperados viram 500 genérico', () => {
    const { status, body } = run(new Error('senha do banco: hunter2'));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
