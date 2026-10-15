import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE = 'rg_refresh';
/** O cookie só viaja para as rotas de autenticação. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function refreshCookieOptions(secure: boolean, maxAgeMs?: number): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: REFRESH_COOKIE_PATH, maxAge: maxAgeMs };
}

export function readRefreshCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(secure));
}
