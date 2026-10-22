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

## Backups

Scripts `scripts/backup.sh` e `scripts/restore.sh`, com política, retenção, teste
mensal de restauração e monitoramento em [OPERATIONS.md](OPERATIONS.md). O
backup usa `DIRECT_DATABASE_URL` (dono do banco): o papel `rotagest_app` está
sujeito ao RLS e geraria um dump incompleto.

## Dados pessoais (LGPD)

- **Dados tratados**: nome, e-mail e senha (hash) dos usuários; dados cadastrais da empresa (CPF quando pessoa física); IP e navegador em sessões e auditoria. Nas próximas fases: dados de motoristas (CPF, telefone) e contratantes.
- **Finalidade**: operar a conta, controlar acesso e manter trilha de auditoria. Não há venda nem compartilhamento com terceiros.
- **Minimização**: logs não registram senhas, tokens ou cookies; mensagens de erro não expõem dados de outros tenants.
- **Isolamento**: cada empresa só acessa os próprios dados; o SUPER_ADMIN não acessa dados financeiros por padrão.
- **Pendências (Fase 6)**: política de privacidade publicada, termo de uso, fluxo de exportação e exclusão de dados do titular, prazo de retenção de logs e auditoria, encarregado (DPO) definido.
