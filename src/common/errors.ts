import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';

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
  VALIDATION_ERROR: 'VALIDATION_ERROR',
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
