import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

/** Texto opcional em que vazio (ex.: `SMTP_URL=` no .env) equivale a ausente. */
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

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
  // Rotinas periódicas (fim do período de teste). Desligue em réplicas extras se quiser; há lock no banco.
  JOBS_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  RATE_LIMIT_DEFAULT: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_AUTH: z.coerce.number().int().positive().default(10),
  // Gateway de pagamento da assinatura SaaS. Vazio = sem cobrança automática (ativação administrativa).
  BILLING_PROVIDER: z.string().trim().optional(),
  STORAGE_DIR: z.string().default('./storage'),
  ATTACHMENT_MAX_MB: z.coerce.number().int().min(1).max(50).default(10),
  // Fase 6 — produção.
  // E-mail: sem SMTP_URL os e-mails só são registrados no log.
  SMTP_URL: optionalText.refine((v) => !v || /^smtps?:\/\//.test(v), 'SMTP_URL deve começar com smtp:// ou smtps://'),
  MAIL_FROM: z.string().trim().min(3).default('RotaGest <nao-responda@rotagest.com.br>'),
  // Comprovantes: disco local (STORAGE_DIR) ou bucket S3 compatível (AWS, MinIO, R2...).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: optionalText,
  S3_REGION: optionalText,
  S3_ENDPOINT: optionalText.refine((v) => !v || /^https?:\/\//.test(v), 'S3_ENDPOINT deve ser uma URL http(s)'),
  S3_FORCE_PATH_STYLE: bool,
  // Token Bearer do /metrics (Prometheus). Vazio = endpoint desativado (404).
  METRICS_TOKEN: optionalText.refine((v) => !v || v.length >= 16, 'METRICS_TOKEN deve ter pelo menos 16 caracteres'),
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
  if (parsed.data.STORAGE_DRIVER === 's3' && (!parsed.data.S3_BUCKET || !parsed.data.S3_REGION)) {
    throw new Error('Configuração inválida: STORAGE_DRIVER=s3 exige S3_BUCKET e S3_REGION');
  }
  return parsed.data;
}
