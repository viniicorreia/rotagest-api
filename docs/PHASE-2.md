# Fase 2 — Financeiro MVP

Status: **concluída**, sobre os modelos que já estavam no schema da Fase 1 (nenhuma migration nova). Tudo grava e lê do PostgreSQL pela API; o web não calcula saldo, status, vencimento nem resultado.

## Funcionalidades implementadas

| Área | O que funciona |
|---|---|
| Veículos | Cadastro, edição, arquivar/reativar e excluir (só sem histórico). Placa antiga ou Mercosul normalizada. Limite do plano conferido com lock da empresa ao criar e ao reativar. Detalhe com receita, custo direto e resultado mês a mês (competência). |
| Categorias | 15 de despesa e 3 de receita padrão criadas para cada empresa (não renomeáveis), mais categorias próprias. Desativar tira dos formulários e preserva o histórico. |
| Contas | Corrente, poupança, caixa e outra. Saldo inicial (pode ser negativo) vira lançamento de abertura. Saldo = soma do razão (`AccountTransaction`), nunca um campo editável. Extrato por período com saldo anterior, entradas, saídas, saldo a cada linha e exportação CSV. Conta com saldo não pode ser desativada. |
| Ajuste de saldo | Permissão própria (`accounts:adjust`) e justificativa de no mínimo 10 caracteres; fica no extrato como ajuste. |
| Transferências | Entre contas da empresa, idempotentes, sem virar receita nem despesa. Estorno gera lançamentos opostos com data de hoje; nada é apagado. |
| Contas a pagar e a receber | Avulsa, parcelada (resto dos centavos na última parcela; dia preferido preservado em meses curtos) e recorrente (mensal ou anual, gerada até o mês seguinte, sem duplicar). Competência separada do vencimento. "Vencida" é calculada (vencimento < hoje no fuso de São Paulo), nunca gravada. Editar, cancelar (só esta ou esta e as próximas) e lançar já pago/recebido. |
| Pagamentos e recebimentos | Parciais, com conta, forma e data. Idempotentes por chave: repetir devolve o mesmo pagamento; mesma chave com dados diferentes dá 409. Linha da obrigação travada (`FOR UPDATE`) contra pagamento duplo concorrente. Estorno com justificativa reabre o saldo devedor. |
| Fechamento | Lançar, pagar ou estornar em mês com fechamento CLOSED retorna 409 `PERIOD_CLOSED` (a tela de fechamento é da Fase 5). |
| Anexos | Comprovantes PDF/PNG/JPG/WebP (tipo detectado pelos bytes, não pela extensão), até `ATTACHMENT_MAX_MB`. Armazenamento privado; download só pela API com conferência de empresa e permissão. |
| Dashboard | Saldo em contas hoje; caixa (recebido, pago, saldo do período) e competência (receitas, despesas, lucro) sempre rotulados; a pagar e a receber (vencido, próximos 7 dias, em aberto); custo médio por veículo; entradas e saídas e receitas x despesas dos últimos 6 meses; despesas por categoria; resultado por veículo com linha "Não alocado". Filtros de período, veículo e categoria. |
| Web | Telas de Despesas, Receitas, Veículos (lista e detalhe), Contas (lista, extrato, transferência, ajuste), Categorias em Configurações e o novo Início. No celular, a barra inferior mostra Início, Despesas, Receitas, Veículos e "Mais". Quem não tem `finance:read` continua vendo o Início da Fase 1. |

Validação no navegador (web :5173 e API :3000, celular 390 px e desktop 1366 px): cadastro, duas contas (saldo total R$ 10.500), veículo, despesa avulsa com veículo, despesa em 3 parcelas, receita já recebida, pagamento parcial de R$ 700. O dashboard fechou em R$ 17.800 (10.500 + 8.000 − 700), sem rolagem horizontal e sem erros no console além dos 401 esperados da renovação de sessão no login. Capturas em `rotagest-web/docs/screenshots/fase-2/`.

## Arquivos principais

**rotagest-api**
```
src/domain/{money,calendar,plates,categories}.ts  (+ finance.spec.ts)
src/common/{errors,serialize}.ts · src/common/validation/index.ts
src/modules/transactions/   ledger.service.ts · period-lock.service.ts
src/modules/categories/     src/modules/vehicles/      src/modules/accounts/ (contas + transferências)
src/modules/settlements/    src/modules/obligations/ (agenda, recorrência, DTOs comuns)
src/modules/payables/       src/modules/receivables/   src/modules/attachments/
src/modules/dashboard/      (dashboard + resultado por veículo)
openapi.json (51 rotas) · test/fleet-accounts.e2e-spec.ts · test/obligations.e2e-spec.ts
```

**rotagest-web**
```
src/api/{schema.d.ts,types.ts,client.ts}       (upload/download multipart)
src/lib/{money,dates}.ts                        (formatação; nenhum cálculo financeiro)
src/components/ui/{money-input,segmented,stat-card}.tsx
src/features/finance/   lista, formulário, detalhe, pagamento, recorrências, anexos, gráficos
src/features/vehicles/  src/features/accounts/  src/features/dashboard/  src/features/settings/categories-card.tsx
src/components/layout/{nav.ts,app-layout.tsx}   src/app/router.tsx
```

## Migrations

Nenhuma nova. A Fase 1 já criou todas as tabelas, FKs compostas por empresa e o trigger que impede alterar ou apagar lançamentos do razão.

## Testes

- API: **94** (domínio + e2e com PostgreSQL real). Os novos cobrem limite do plano de veículos, saldo e extrato, transferência e estorno, ajuste sem permissão, parcelamento e recorrência sem duplicar, pagamento parcial, pagamento concorrente (só um passa), repetição idempotente e conflito de chave, período fechado, isolamento entre empresas (404), permissões do motorista e números do dashboard reconciliados com o saldo das contas.
- Web: **9** (inclui conversão de valores digitados como "1.234,56").
- Contrato: teste falha se `openapi.json` estiver desatualizado; `tsc` do web passa contra os tipos gerados.

## Comandos

```bash
# API
cd rotagest-api && npm ci && npx prisma migrate deploy && npm run start:dev
npm test                      # unitários + e2e (usa rotagest_test)
npm run openapi:export        # após mudar DTOs

# Web
cd rotagest-web && npm ci && npm run dev
OPENAPI_SOURCE=../rotagest-api/openapi.json npm run api:types
npx tsc --noEmit && npx vitest run && npm run build
```

Novas variáveis da API: `STORAGE_DIR` (padrão `./storage`) e `ATTACHMENT_MAX_MB` (padrão 10).

## Pendências (ficam para as próximas fases)

- Rateio de despesa entre veículos (hoje: veículo único = 100% direto; o restante aparece como "Não alocado"). Fase 3.
- Fornecedores, aprovação de despesas e despesas lançadas pelo motorista (`expenses:own`). Fase 3.
- Contratos gerando contas a receber automaticamente. Fase 3/4.
- Tela de fechamento mensal (a trava do período já funciona na API). Fase 5.
- Anexos em armazenamento de objetos (S3 ou similar) em produção; hoje é disco local privado.
- O bundle do web passou de 500 kB por causa do Recharts; dividir por rota fica para quando houver mais telas.
