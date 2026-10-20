# Fase 3 — Transporte (com registro diário de km)

Status: **concluída**. Tudo grava e lê do PostgreSQL pela API; o web só formata valores.

## Funcionalidades implementadas

| Área | O que funciona |
|---|---|
| Valor por km do veículo | Campo `ratePerKm` (até 4 casas). Ao mudar, recalcula opcionalmente os dias ainda não faturados de meses abertos. |
| Registro diário de km | Um registro por veículo por dia: km direto ou hodômetro de saída/chegada (a API calcula e confere). Valor do dia = km × R$/km, calculado em inteiros na API e gravado com a taxa da data. Duplicado → 409; mês fechado → 409 `PERIOD_CLOSED`; dia faturado não muda (422). |
| Faturamento do km | Prévia por veículo no mês e geração de uma conta a receber por veículo (“Km rodados MM/AAAA — Van (km)”), com os dias travados `FOR UPDATE` e ligados à conta. Cancelar a conta libera os dias. |
| Motoristas, rotas e escalas | CPF validado, vínculo opcional com um usuário da empresa, escalas com início/fim (sem sobreposição para a mesma rota e veículo/motorista), encerramento sem apagar histórico. |
| Portal do motorista (“Meu dia”) | Escala de hoje, km do dia do veículo escalado (até 7 dias para trás), histórico sem valores em dinheiro, envio de despesas com comprovante. |
| Despesas do motorista e aprovação | Entram como `PENDING_APPROVAL` e ficam fora de saldos, dashboard, resultado e pagamento até alguém com `expenses:approve` aprovar. Recusa exige motivo e cancela; o motorista pode retirar a que ainda não foi analisada. Quem aprova vê e baixa o comprovante. |
| Rateio | Despesas e receitas divididas entre veículos por partes iguais, percentual (soma 100%) ou valor fixo (soma o total), sem perder centavos. Mudar o valor reaplica as proporções; recorrências repetem o rateio. |
| Contratantes e contratos | Contratante (escola, prefeitura, empresa, pessoa), contratos com veículos (percentual opcional) e rotas. Ativar gera uma conta a receber por competência (até o mês seguinte, sem duplicar), rateada pelos veículos. Encerrar/cancelar cancela as cobranças futuras em aberto. |
| Manutenção e abastecimento | Cada lançamento gera a conta a pagar ligada ao veículo (opcionalmente já paga). Abastecimento = litros × preço (ou o total da nota). Resumo mensal por veículo: km, valor do km, litros, combustível, manutenção, km/l e custo por km. |

Validação no navegador (celular 390 px e desktop 1366 px, API e web locais): valor por km de R$ 3,50 na Van 01, 120 km registrados → R$ 420,00; motorista vê a escala e o km do dia, envia pedágio com PDF; gestor vê o comprovante e aprova; “Faturar km do mês” gerou a conta a receber “Km rodados 10/2026 — Van 01 (120,0 km)” de R$ 420,00. Sem rolagem horizontal e sem erros no console. Capturas em `rotagest-web/docs/screenshots/fase-3/`.

## Arquivos principais

**rotagest-api**
```
prisma/migrations/20261020160719_vehicle_daily_logs/   (única migration da fase)
src/domain/mileage.ts                    km, R$/km, litros, km/l e custo por km em inteiros
src/modules/mileage/                     registro diário e faturamento por km
src/modules/fleet/                       motoristas, rotas, escalas
src/modules/contracts/                   contratantes, contratos, geração por competência
src/modules/fleet-costs/                 manutenção, abastecimento, resumo, despesas do motorista e aprovação
src/modules/obligations/allocation.ts    rateio
src/common/decorators + guards           @RequireAnyPermission
test/mileage.e2e-spec.ts · test/transport.e2e-spec.ts
```

**rotagest-web**
```
src/features/mileage/     Km diário, lançamento rápido, faturamento
src/features/driver/      Meu dia (motorista) e Aprovações
src/features/fleet/       Motoristas, rotas e escalas
src/features/contracts/   Contratos e contratantes
src/features/costs/       Manutenção, abastecimento e resumo por veículo
src/features/vehicles/    valor por km · src/features/finance/ rateio no formulário e no detalhe
```

## Migrations

`20261020160719_vehicle_daily_logs`: `vehicles.ratePerKm` e a tabela `vehicle_daily_logs` (único por empresa+veículo+dia, FKs compostas por empresa, CHECKs de km 0–5000, hodômetro e valor). Os demais modelos já existiam desde a Fase 1.

## Testes

- API: **120** (domínio + e2e com PostgreSQL real), incluindo km × taxa, hodômetro, recálculo da taxa, permissões do motorista, faturamento e cancelamento, isolamento entre empresas, período fechado, rateio (percentual, igual, validações), contratos, manutenção, abastecimento, resumo e o fluxo de aprovação.
- Web: **20** testes, `tsc` e `vite build` ok.

## Comandos

```bash
cd rotagest-api && npx prisma migrate deploy && npm test && npm run openapi:export
cd rotagest-web && OPENAPI_SOURCE=../rotagest-api/openapi.json npm run api:types && npm run typecheck && npm test && npm run build
```

## Pendências

- Relatórios com exportação PDF/Excel e tela de fechamento mensal: Fase 4.
- O resumo de custos por veículo considera combustível e manutenção; demais despesas do veículo aparecem no resultado por veículo do dashboard.
- Bundle do web acima de 500 kB (dividir por rota quando entrar a Fase 4).
