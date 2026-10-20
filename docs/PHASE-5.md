# Fase 5 — Comercialização: painel da plataforma, planos e assinaturas

Status: **concluída**. Tudo grava e lê do PostgreSQL pela API; o web só formata.

## Funcionalidades implementadas

| Área | O que funciona |
|---|---|
| Painel `/platform` (SUPER_ADMIN) | Área própria, sem precisar de empresa. A API confere o papel em cada requisição (relido do banco). Quem não é SUPER_ADMIN recebe 403; o administrador sem empresa entra direto no painel. |
| Indicadores | Empresas por situação, assinaturas por status e por plano, MRR contratado (assinaturas ativas; anuais divididas por 12), novas empresas em 30 dias, testes terminando em 7 dias, assinaturas em atraso, veículos e membros ativos. |
| Empresas | Lista com busca (nome, razão social, e-mail, documento), filtro por situação e paginação; detalhe com cadastro, proprietários, assinatura, uso e histórico das ações da plataforma. Suspender, reativar ou cancelar exige justificativa (10–500 caracteres) e fica na auditoria. Suspensa bloqueia o acesso de todos os membros na hora; nada é apagado. |
| Sem dados financeiros | O painel lê só dados cadastrais e contagens de uso. O SUPER_ADMIN não é membro das empresas e recebe 403 nas rotas delas. |
| Planos | Criar e editar nome, descrição, preço, periodicidade, limites de veículos e usuários (vazio = ilimitado), visibilidade, ordem e recursos (catálogo fixo no código, escolha por plano no banco). Arquivar em vez de apagar; o plano padrão não pode ser arquivado (422). |
| Assinaturas (ativação administrativa) | Trocar plano (só ativos), status, fim do teste, fim do período e exceções negociadas de limite, sempre com justificativa auditada (antes/depois). Ativar encerra o teste e abre o período. Uso acima do novo limite gera aviso: nada é removido, novos cadastros ficam bloqueados (409 `PLAN_LIMIT_REACHED`). Assinatura suspensa ou cancelada bloqueia o acesso; em atraso não. |
| Configurações globais | Pausar a criação de novas empresas (403 `SIGNUPS_CLOSED`), plano padrão, dias de teste (0 = já começa ativa) e e-mail de suporte. Sem configuração gravada valem `DEFAULT_PLAN_CODE` e `TRIAL_DAYS`. |
| Página da assinatura (dono) | Plano, uso, comparação com os planos públicos (`GET /plans`) e contato com o suporte para mudar de plano. Nenhum botão de pagamento. |
| Gateway de pagamento (preparado) | Interface `PaymentGateway` (cliente, assinatura, cancelamento, validação de webhook), `BillingService` e `POST /billing/webhooks/:provider`. Sem `BILLING_PROVIDER` o webhook responde 404 e nada é cobrado. Eventos ficam em `billing_events` (únicos por provedor + id, aplicados uma vez) e as mudanças de status são auditadas. A cobrança SaaS nunca gera lançamentos no financeiro das empresas. |

Validação no navegador (celular 390 px e desktop 1366 px, API e web locais): o administrador sem empresa entrou direto no painel. Criou o plano "Uma Van" (R$ 19,90, 1 veículo), e o formulário recusou o limite de usuários vazio sem "Ilimitado". Trocou a assinatura de uma empresa com 2 vans para esse plano e recebeu o aviso de uso acima do limite. Suspendeu a empresa, e o dono passou a ver a empresa como suspensa. Reativou a empresa e salvou o e-mail de suporte, que apareceu para o dono na página da assinatura. O dono, ao abrir `/platform`, recebeu acesso negado. Sem rolagem horizontal e sem erros no console. Capturas em `rotagest-web/docs/screenshots/fase-5/`.

## Arquivos principais

**rotagest-api**
```
prisma/migrations/20261020183017_platform_settings_billing/   platform_settings (linha única) e billing_events
src/modules/platform/                  painel: indicadores, empresas, planos, assinaturas, configurações
src/modules/billing/                   PaymentGateway, BillingService, webhook
src/modules/subscriptions/             PlatformSettingsService, GET /plans, /subscription com suporte e gateway
src/common/guards/platform-admin.guard.ts
src/common/tenant/tenant-resolver.service.ts   assinatura suspensa/cancelada bloqueia o acesso
src/domain/plan-features.ts            catálogo de recursos
test/platform.e2e-spec.ts
```

**rotagest-web**
```
src/features/platform/                 layout, visão geral, empresas, planos, assinaturas, configurações
src/features/subscriptions/            planos disponíveis e contato para mudar de plano
src/app/guards.tsx · router.tsx · components/layout/user-menu.tsx   rota /platform e atalho no menu
docs/screenshots/fase-5/
```

## Migrations

`20261020183017_platform_settings_billing`: tabela `platform_settings` (CHECK de linha única e de dias de teste entre 0 e 90, FK para o plano padrão) e `billing_events` (único por provedor + id externo, FK para a empresa).

## Testes

- API: **141** (domínio + e2e com PostgreSQL real). Novos: acesso só para SUPER_ADMIN e sem empresa; lista e detalhe sem dados financeiros (admin recebe 403 nas rotas da empresa); suspender e reativar com auditoria; criar e editar planos com recursos válidos; troca de plano com aviso e limite aplicado, exceção negociada, MRR; assinatura suspensa bloqueia, em atraso não; plano arquivado e plano padrão; configurações valendo no onboarding e pausa de novas empresas; lista pública de planos; webhook (404 sem gateway, assinatura inválida, idempotência, status e auditoria).
- Web: **36** testes, `tsc` e `vite build` ok.

## Comandos

```bash
cd rotagest-api && npx prisma migrate deploy && npm run prisma:seed && npm test && npm run openapi:export
# para criar o administrador: SEED_SUPER_ADMIN_EMAIL e SEED_SUPER_ADMIN_PASSWORD no .env antes do seed
cd rotagest-web && OPENAPI_SOURCE=../rotagest-api/openapi.json npm run api:types && npm run typecheck && npm test && npm run build
```

## Pendências

- Nenhum gateway real está integrado (por decisão da especificação: não simular cobranças). Para integrar, basta um adaptador de `PaymentGateway` e `BILLING_PROVIDER`.
- Os recursos dos planos são configuráveis e aparecem para as empresas, mas ainda não liberam ou bloqueiam telas. Ligar cada recurso a uma regra exige decidir o que acontece com quem já usa (ex.: o Starter de hoje não tem exportação).
- Acesso de suporte a dados de uma empresa com consentimento do dono, prazo e auditoria: Fase 6 (como previsto na arquitetura).
- O fim do teste não muda o status sozinho; a lista "testes terminando" mostra quem precisa de ação. Uma rotina automática pode entrar na Fase 6.
