# Fase 1 — Fundação SaaS

Status: **concluída**, em dois repositórios independentes (`rotagest-api` e `rotagest-web`). Tudo abaixo usa persistência real no PostgreSQL e tem testes; nada depende de dados simulados.

## Funcionalidades implementadas

| Área | O que funciona |
|---|---|
| Repositórios | `rotagest-api` e `rotagest-web` têm cada um seu `package.json`, lockfile npm, `.env.example`, Dockerfile e histórico Git. Não há workspace nem dependência de código entre eles. |
| Contrato | Rotas em `/api/v1`, Swagger em `/api/docs`, JSON em `/api/docs-json` e `openapi.json` versionado. O web gera `src/api/schema.d.ts` com `openapi-typescript`. Um teste falha se o contrato versionado ficar desatualizado. |
| Banco | O schema Prisma **completo** cobre todas as fases (33 modelos), com FKs compostas por tenant, CHECKs e triggers de imutabilidade (auditoria e razão financeiro). Por enquanto, só os módulos da Fase 1 usam as tabelas. |
| Autenticação | Cadastro, login, refresh rotativo com detecção de reuso, logout, sair de todos os dispositivos, esqueci/redefinir senha e `GET /auth/me`. |
| Empresas | Onboarding com CPF ou CNPJ validado. A assinatura Starter em trial é criada junto. A edição dos dados é auditada (antes/depois). |
| Membros | Listar, alterar papel e permissões extras (gestor configurável), desativar, reativar e remover. O último proprietário e o próprio acesso ficam protegidos. |
| Convites | Criar (e-mail + link para WhatsApp), visualizar publicamente, aceitar (só pelo e-mail convidado), gerar novo link, revogar e expirar. |
| Troca de empresa | Seletor no topo. Cada troca emite um novo token com a empresa validada no banco e limpa o cache do frontend. |
| Multi-tenant | O TenantGuard resolve a empresa no backend a cada requisição. Ids de outro tenant retornam 404, e o `companyId` enviado pelo cliente é ignorado ou rejeitado. |
| RBAC | 21 permissões e os papéis OWNER, MANAGER, FINANCIAL e DRIVER. O catálogo é publicado em `GET /api/v1/meta/access-control` para o web montar as telas sem duplicar regras. |
| Planos e limites | Planos ficam no banco (seed). O limite de usuários conta membros + convites pendentes, com lock contra concorrência, e aceita override por assinatura (Business). |
| Auditoria | Login, falhas, reuso de refresh, empresa, membros, convites e redefinição de senha. |
| Infra API | Logs pino com `x-request-id`, Helmet, CORS com credenciais restrito a `CORS_ORIGINS`, rate limit e Docker Compose (API + PostgreSQL). |
| Frontend | Cliente HTTP único (`src/api/client.ts`) com `VITE_API_URL`, Bearer, renovação única de sessão e erros padronizados. Telas de login, cadastro, recuperação de senha, convite, onboarding, seletor de empresa, dashboard, equipe, assinatura e configurações. Mobile first, com bottom navigation e botão flutuante; sidebar recolhível no desktop; tema claro/escuro; skeletons, estados vazios, toasts e confirmações. |

O fluxo completo foi executado no navegador com os dois projetos em origens diferentes (web em :5173, API em :3000): cadastro, empresa, convite, aceite pelo motorista, bloqueio de rota sem permissão e restauração da sessão ao recarregar. As capturas estão em `rotagest-web/docs/screenshots/`.

## Arquivos principais

**rotagest-api**
```
prisma/schema.prisma · prisma/seed.ts · prisma/migrations/*
src/main.ts · src/app.module.ts · src/setup-app.ts        /api/v1, CORS, Swagger
src/config/*                                               validação de ambiente
src/domain/*                                               papéis, permissões, CPF/CNPJ
src/common/*                                               guards, decorators, tenant, erros, DTOs comuns
src/modules/{auth,companies,memberships,subscriptions,audit,mail,meta,health}/*
scripts/export-openapi.ts · openapi.json
test/*                                                     e2e e contrato
Dockerfile · docker-compose.yml · .env.example · docs/*
```

**rotagest-web**
```
src/api/{client.ts,schema.d.ts,types.ts}
src/app/* · src/components/{ui,layout}/* · src/lib/*
src/features/{auth,companies,dashboard,invitations,settings,subscriptions,team}/*
Dockerfile · nginx.conf · .env.example
```

## Migrations

| Migration | Conteúdo |
|---|---|
| `20261015173435_init` | Todas as tabelas, enums, índices, unicidades por empresa e FKs (inclusive compostas). |
| `20261015173500_integrity_constraints` | CHECKs (documento, valores > 0, competência no dia 1, liquidação com dono único, transferência entre contas distintas...), trigger append-only da auditoria, trigger de imutabilidade do razão e índice de saldo inicial único por conta. |

`prisma migrate diff` confirma que o schema e as migrations estão sincronizados.

## Testes

| Repositório / suíte | Testes | Cobre |
|---|---:|---|
| api `test/auth.e2e-spec.ts` | 15 | Login, cadastro, Argon2id, mensagens genéricas, usuário bloqueado, rotação de refresh, reuso → revogação da família, refresh concorrente, logout, redefinição de senha de uso único e rate limit. |
| api `test/tenancy.e2e-spec.ts` | 13 | Associação usuário ↔ empresa, troca de empresa (inclusive para empresa alheia), acesso cruzado por id, `companyId` forjado no corpo/query/token, membro desativado, empresa suspensa, FK composta no banco e erros sem vazamento. |
| api `test/memberships.e2e-spec.ts` | 15 | Convites ponta a ponta, e-mail errado, convite revogado/expirado/novo link, limites do plano (inclusive concorrência), permissões de motorista/financeiro/gestor, gestor configurável, último proprietário, remoção, auditoria append-only e edição auditada. |
| api `test/contract.e2e-spec.ts` | 4 | Todas as rotas em `/api/v1`, `openapi.json` atualizado, catálogo de acesso e CORS restrito com credenciais. |
| api `src/**/*.spec.ts` | 10 | Domínio (CPF/CNPJ, permissões), filtro de erros e guard de permissões. |
| web | 6 | URL da API por ambiente, refresh único para 401 simultâneos, token só em memória, proteção contra open redirect e validações de formulário. |

Resultado: **63 testes passando** (57 na API e 6 no web). Os testes da seção 24 que dependem de módulos financeiros (veículos, contratos, liquidações, rateio, fechamento etc.) entram nas fases em que esses módulos forem implementados.

## Como executar os dois localmente

```bash
# Terminal 1: rotagest-api
npm install
cp .env.example .env               # DATABASE_URL, JWT_ACCESS_SECRET, CORS_ORIGINS=http://localhost:5173
npx prisma migrate deploy && npm run prisma:seed
npm run start:dev                  # http://localhost:3000/api/v1 (Swagger: /api/docs)

# Terminal 2: rotagest-web
npm install
cp .env.example .env               # VITE_API_URL=http://localhost:3000/api/v1
npm run dev                        # http://localhost:5173

# Testes
createdb rotagest_test && npm test # na API
npm test                           # no web
```

## Pendências e observações

- **Docker**: os Dockerfiles e o Compose foram escritos, mas não executados neste ambiente (não há daemon Docker). Os dois projetos foram validados rodando diretamente com Node e PostgreSQL 16.
- **Repositórios remotos**: os dois repositórios Git estão prontos localmente na pasta do projeto. Para publicar no GitHub, basta dizer onde.
- **E-mail**: sem SMTP configurado, os e-mails vão para o log (o link só aparece fora de produção). O convite também devolve o link para compartilhar manualmente. O SMTP real fica para a Fase 6.
- **Painel SUPER_ADMIN** (`/platform/*`): Fase 5. O papel já existe no banco e no seed.
- **Limite de veículos**: já é calculado e exibido; a verificação no cadastro de veículos entra na Fase 2.
- **Row-Level Security**: desenhada em `ARCHITECTURE.md §5.6`, com implementação na Fase 6.
- **Cookie de sessão**: em produção, web e API precisam estar no mesmo site (subdomínios do mesmo domínio) e com HTTPS.
- **Política de privacidade e termos**: os textos jurídicos dependem de definição do negócio (Fase 6).

## Próxima fase

Fase 2 — Financeiro MVP: veículos (com limite do plano); categorias padrão e personalizadas; contas financeiras com saldo inicial; contas a pagar e a receber (avulsas, recorrentes e parceladas); liquidações parciais idempotentes; transferências; comprovantes; e dashboard com dados reais.
