# Fase 4 — Relatórios e fechamento mensal

Status: **concluída**. Todos os números vêm da API (PostgreSQL); o web só formata e baixa os arquivos.

## Funcionalidades implementadas

| Área | O que funciona |
|---|---|
| 10 relatórios (§19) | Fluxo de caixa, receitas por contrato, despesas por categoria, resultado por veículo, resultado por rota, resultado por período, contas a pagar, contas a receber, combustível e manutenção. Cada relatório declara o regime (caixa, competência, vencimento ou operacional) e traz seções com totais calculados em centavos. |
| Filtros | Período de até 24 meses, veículo, rota, contrato, categoria, conta e situação (em aberto, vencida, quitada), conforme o relatório. Todo ID de filtro é conferido contra a empresa do usuário; ID de outra empresa → 404. |
| Comparativo | `compare=true` calcula o período anterior de mesmo tamanho e devolve os totais lado a lado. |
| Exportação PDF e Excel | `GET /reports/:key/export?format=pdf|xlsx` com os mesmos dados da tela. PDF em A4 paisagem com cabeçalho repetido a cada página, totais, comparativo, notas e “página X de N”; Excel com uma aba por seção e formatos de moeda, percentual e data. |
| Fechamento mensal (§18) | Lista os 12 meses do ano com a situação. Prévia sem gravar (resultado gerencial, caixa, saldo das contas, pendências e avisos). Fechar grava um retrato (snapshot) do mês, exige que o mês tenha terminado (422), é serializado por lock e por `expectedVersion` (409) e bloqueia lançamentos do mês (409 `PERIOD_CLOSED`). |
| Reabertura | Só o dono (`closing:reopen`), com justificativa de 10 a 500 caracteres, registrada na auditoria com o retrato anterior. Fechar de novo cria a versão seguinte. O PDF/Excel de um mês fechado usa o retrato gravado. |
| Rateio proporcional à receita (§15) | Novo método para despesas: cada veículo paga na proporção da receita (contas a receber não canceladas) que gerou na competência. Os pesos ficam gravados; veículo sem receita fica de fora; nenhum com receita → 422. Receitas não aceitam esse método (400). |
| Telas | `/app/reports` (catálogo, filtros, presets de período, comparativo, tabelas no desktop e cartões no celular, botões PDF/Excel) e `/app/monthly-closing` (ano, detalhe do mês, prévia, confirmação, reabertura com justificativa, exportação). |
| Downloads | A API agora expõe `Content-Disposition` no CORS, então os arquivos baixam com o nome certo (também vale para os comprovantes da Fase 3). |

Validação no navegador (celular 390 px e desktop 1366 px, API e web locais, dados criados pela API): duas vans com R$ 4.500 e R$ 3.000 de receita em setembro, seguro de R$ 600 rateado pela receita (R$ 360 / R$ 240) e contador de R$ 450 em partes iguais. Resultado por veículo mostrou Van 01 R$ 3.015,00 (67,00%) e Van 02 R$ 1.885,00 (62,83%), comparativo com agosto, PDF e Excel baixados. O fechamento de setembro mostrou a prévia, fechou, a API recusou um lançamento no mês com 409 `PERIOD_CLOSED`, e a reabertura com justificativa voltou a liberar o mês. Sem rolagem horizontal e sem erros no console. Capturas em `rotagest-web/docs/screenshots/fase-4/`.

## Arquivos principais

**rotagest-api**
```
src/modules/reports/report.types.ts      colunas, seções e totais em centavos
src/modules/reports/report-export.ts     PDF (pdfkit) e Excel (exceljs)
src/modules/reports/reports.service.ts   os 10 relatórios, filtros validados por empresa, comparativo
src/modules/reports/reports.controller.ts  GET /reports, /reports/:key, /reports/:key/export
src/modules/closings/                    prévia, fechar, reabrir, exportar, listar o ano
src/modules/obligations/allocation.ts    rateio proporcional à receita
src/setup-app.ts                         Content-Disposition exposto no CORS
test/reports.e2e-spec.ts · test/transport.e2e-spec.ts
```

**rotagest-web**
```
src/features/reports/     catálogo, filtros, visualização e exportação
src/features/closings/    ano, detalhe do mês, prévia, fechar e reabrir
src/features/finance/obligation-form-dialog.tsx  opção “Pela receita” no rateio de despesas
docs/screenshots/fase-4/
```

## Migrations

Nenhuma. `MonthlyClosing`, `AuditLog` e o valor `REVENUE_PROPORTIONAL` do enum de rateio já existiam desde a Fase 1.

Dependências novas na API (versões exatas): `exceljs 4.4.0`, `pdfkit 0.17.2`, `@types/pdfkit` (dev).

## Testes

- API: **131** (domínio + e2e com PostgreSQL real). Novos: resultado por veículo com custo direto e rateado, fluxo de caixa pela data efetiva fechando com o saldo das contas, despesas por categoria com comparativo, exportação PDF/Excel, isolamento entre empresas, 403 para motorista, limite de 24 meses, prévia, fechar, bloqueio do mês, reabertura (permissão, justificativa, auditoria), versão 2, e rateio proporcional à receita.
- Web: **27** testes, `tsc` e `vite build` ok.

## Comandos

```bash
cd rotagest-api && npm install && npx prisma migrate deploy && npm test && npm run openapi:export
cd rotagest-web && OPENAPI_SOURCE=../rotagest-api/openapi.json npm run api:types && npm run typecheck && npm test && npm run build
```

## Pendências

- O fechamento serializa fechamentos concorrentes do mesmo mês, mas um lançamento que já estava em andamento no instante do fechamento pode terminar logo depois. A trava por linha no período fica para a Fase 6 (junto com RLS).
- Exportação de relatórios é síncrona; relatórios muito grandes (anos de dados) podem precisar de fila na Fase 6.
- Bundle do web acima de 500 kB; dividir por rota fica para a Fase 6.
- Seguem as Fases 5 (painel da plataforma, planos e limites) e 6 (RLS, SMTP, S3, observabilidade, backups, LGPD, CI/CD).
