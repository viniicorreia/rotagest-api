# Segurança, backups e dados pessoais

## Controles implementados (Fase 1)

| Controle | Onde |
|---|---|
| Senhas Argon2id (19 MiB, t=2, p=1) com rehash | `src/modules/auth/password.service.ts` |
| Access token JWT HS256 de 15 min, com `iss`/`aud`, só em memória no navegador | `auth.module.ts`, `rotagest-web: src/lib/token-store.ts` |
| Refresh token opaco, só hash no banco, cookie `HttpOnly` + `SameSite=Strict` + `Path=/api/auth`, rotação e revogação da família em caso de reuso | `session.service.ts`, `refresh-cookie.ts` |
| Sessão revalidada a cada requisição (logout, bloqueio e reuso valem na hora) | `common/guards/jwt-auth.guard.ts` |
| TenantContext resolvido no backend, vínculo e empresa revalidados a cada requisição | `common/guards/tenant.guard.ts`, `common/tenant/` |
| RBAC por permissão | `src/domain/permissions.ts`, `common/guards/permissions.guard.ts` |
| FKs compostas `(companyId, id)` e CHECKs no banco | `prisma/schema.prisma`, migration `integrity_constraints` |
| Auditoria append-only (trigger) | `modules/audit`, migration `integrity_constraints` |
| Rate limiting global e estrito em autenticação | `app.module.ts` |
| Validação de DTOs com whitelist, Helmet, CORS restrito | `setup-app.ts` |
| Erros sem detalhes internos, com `requestId` | `common/filters/all-exceptions.filter.ts` |
| Logs estruturados (pino) com redação de tokens, senhas e cookies | `app.module.ts` |
| Tokens de convite e redefinição de uso único, só hash no banco | `invitations.service.ts`, `auth.service.ts` |

## Controles da Fase 6

| Controle | Onde |
|---|---|
| Row-Level Security: a API conecta como `rotagest_app`, sem acesso a linhas de outra empresa (ARCHITECTURE §5.7) | migration `row_level_security`, `prisma/prisma.service.ts`, `common/tenant/db-context.ts` |
| `audit_logs` só aceita inserção para o papel da aplicação | migration `row_level_security` |
| Acesso do suporte só com autorização do dono, prazo de até 72 h, somente leitura, cada leitura auditada e visível ao dono | `modules/support-access`, `common/guards/tenant.guard.ts` |
| Exportação de dados e exclusão de conta (LGPD); anonimização de motorista | `modules/privacy`, `modules/fleet` |
| Lançamentos e fechamento do mês serializados por lock no banco | `transactions/period-lock.service.ts`, `closings.service.ts` |
| Anexos privados em S3 (sem ACL pública nem URL assinada), download só pela API | `modules/attachments` |
| `/metrics` protegido por token; health sem dados sensíveis | `modules/metrics`, `modules/health` |
| Imagens Docker sem root; CSP e cabeçalhos de segurança no nginx do web | `Dockerfile`, `rotagest-web/nginx.conf` |

## Backups

Scripts `scripts/backup.sh` e `scripts/restore.sh`, com política, retenção, teste
mensal de restauração e monitoramento em [OPERATIONS.md](OPERATIONS.md). O
backup usa `DIRECT_DATABASE_URL` (dono do banco): o papel `rotagest_app` está
sujeito ao RLS e geraria um dump incompleto.

## Dados pessoais (LGPD)

Inventário, bases legais, retenção, direitos do titular e acesso do suporte em
[PRIVACY.md](PRIVACY.md). A política pública fica no web, em `/privacidade`.
