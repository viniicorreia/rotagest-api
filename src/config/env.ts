import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool,
  SWAGGER_ENABLED: bool,
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: bool,
  INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  DEFAULT_PLAN_CODE: z.string().default('starter'),
  TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  RATE_LIMIT_DEFAULT: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_AUTH: z.coerce.number().int().positive().default(10),
  STORAGE_DIR: z.string().default('./storage'),
  ATTACHMENT_MAX_MB: z.coerce.number().int().min(1).max(50).default(10),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('Configuração inválida: COOKIE_SECURE deve ser true em produção');
  }
  return parsed.data;
}
