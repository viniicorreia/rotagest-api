import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ErrorCode } from '../errors';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/**
 * Tratamento centralizado de erros. Erros de banco viram mensagens genéricas:
 * nomes de constraint, colunas, ids e valores nunca chegam ao cliente.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const body = this.toBody(exception);
    body.requestId = req.id ? String(req.id) : undefined;

    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, requestId: body.requestId }, 'Erro não tratado');
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof ThrottlerException) {
      return { statusCode: 429, code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde um instante e tente novamente.' };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') return { statusCode: status, code: defaultCode(status), message: response };
      const r = response as { message?: string | string[]; code?: string };
      if (Array.isArray(r.message)) {
        return { statusCode: status, code: ErrorCode.VALIDATION_ERROR, message: 'Dados inválidos', details: r.message };
      }
      return { statusCode: status, code: r.code ?? defaultCode(status), message: r.message ?? exception.message };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { statusCode: 409, code: ErrorCode.CONFLICT, message: 'Já existe um registro com esses dados' };
        case 'P2003':
          return { statusCode: 409, code: ErrorCode.CONFLICT, message: 'Registro vinculado a dados inexistentes ou em uso' };
        case 'P2025':
          return { statusCode: 404, code: ErrorCode.NOT_FOUND, message: 'Registro não encontrado' };
      }
    }
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' };
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return ErrorCode.VALIDATION_ERROR;
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 422:
      return ErrorCode.BUSINESS_RULE;
    default:
      return 'ERROR';
  }
}
