import { BadRequestException, ConflictException, UnprocessableEntityException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';

/**
 * Códigos estáveis de erro consumidos pelo frontend. As mensagens são para o
 * usuário final e nunca incluem dados de outros tenants.
 */
export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  NO_ACTIVE_COMPANY: 'NO_ACTIVE_COMPANY',
  COMPANY_ACCESS_DENIED: 'COMPANY_ACCESS_DENIED',
  COMPANY_SUSPENDED: 'COMPANY_SUSPENDED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  SIGNUPS_CLOSED: 'SIGNUPS_CLOSED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** Data/competência em mês com fechamento confirmado. */
  PERIOD_CLOSED: 'PERIOD_CLOSED',
  /** Mesma Idempotency-Key reutilizada com dados diferentes. */
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  /** Operação válida no formato, mas proibida pela regra de negócio (ex.: pagar mais que o saldo em aberto). */
  BUSINESS_RULE: 'BUSINESS_RULE',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export const unauthorized = (message = 'Não autenticado', code: ErrorCodeValue = ErrorCode.UNAUTHENTICATED) =>
  new UnauthorizedException({ message, code });

export const forbidden = (message = 'Você não tem permissão para esta ação', code: ErrorCodeValue = ErrorCode.FORBIDDEN) =>
  new ForbiddenException({ message, code });

export const notFound = (message = 'Registro não encontrado') =>
  new NotFoundException({ message, code: ErrorCode.NOT_FOUND });

export const conflict = (message: string, code: ErrorCodeValue = ErrorCode.CONFLICT) =>
  new ConflictException({ message, code });

export const businessRule = (message: string) => new UnprocessableEntityException({ message, code: ErrorCode.BUSINESS_RULE });

export const badRequest = (message: string) => new BadRequestException({ message, code: ErrorCode.VALIDATION_ERROR });
