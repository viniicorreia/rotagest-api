import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { HealthController } from './health.controller';

const controllerWith = (queryRaw: jest.Mock) => new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);

describe('HealthController', () => {
  afterEach(() => jest.useRealTimers());

  it('liveness não consulta o banco', () => {
    const queryRaw = jest.fn();
    expect(controllerWith(queryRaw).live()).toEqual({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('readiness ok quando o banco responde', async () => {
    await expect(controllerWith(jest.fn().mockResolvedValue([{ '?column?': 1 }])).ready()).resolves.toEqual({ status: 'ok' });
  });

  it('readiness 503 quando o banco falha', async () => {
    await expect(controllerWith(jest.fn().mockRejectedValue(new Error('conexão recusada'))).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('readiness 503 quando o banco não responde a tempo', async () => {
    jest.useFakeTimers();
    const pending = controllerWith(jest.fn().mockReturnValue(new Promise(() => undefined))).ready();
    jest.advanceTimersByTime(2000);
    await expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
