# Dados pessoais (LGPD)

Documento técnico do tratamento de dados pessoais no RotaGest. A política
pública para os usuários fica no web (`/privacidade`) e tem campos que só o
negócio pode preencher (razão social, CNPJ, encarregado, data de vigência).

## Papéis

- **Cada transportadora é controladora** dos dados que cadastra: motoristas,
  contratantes, lançamentos e anexos. O RotaGest trata esses dados como
  **operador**, só para prestar o serviço.
- **O RotaGest é controlador** dos dados de conta (usuários) e dos registros
  de segurança (sessões e auditoria).

## Inventário

| Dado | Onde | Finalidade | Base legal (art. 7º) | Retenção |
|---|---|---|---|---|
| Nome, e-mail, hash da senha do usuário | `users` | Conta e acesso | Execução de contrato | Até a exclusão da conta (anonimização) |
| IP e navegador | `refresh_sessions`, `audit_logs` | Segurança, prevenção a fraude, trilha de auditoria | Legítimo interesse; cumprimento de obrigação (Marco Civil, art. 15: 6 meses de registros de acesso) | Sessões: até expirar ou serem revogadas. Auditoria: ver abaixo |
| CPF/CNPJ, endereço e contato da empresa | `companies` | Cadastro e cobrança | Execução de contrato | Enquanto a empresa existir |
| Nome, CPF, telefone e admissão do motorista | `drivers` | Operação da transportadora | Definida pela transportadora (controladora) | Até a transportadora anonimizar |
| Contratantes (nome, documento, contato) | `contractors` | Contratos e recebimentos | Definida pela transportadora | Enquanto a transportadora mantiver |
| Comprovantes (anexos) | storage local ou S3 | Prova de despesas e pagamentos | Definida pela transportadora | Enquanto o lançamento existir |

**Auditoria.** Fica guardada por pelo menos 5 anos, porque acompanha registros
financeiros sujeitos a guarda fiscal. É só inserção (o papel da aplicação não
tem `UPDATE`/`DELETE`). Ela guarda o identificador do usuário, não o e-mail.
Alterações de motorista guardam os dados enviados no momento. Hoje não há
expurgo automático; um job de expurgo de IP e navegador com mais de
6 meses/5 anos depende da decisão do controlador sobre o prazo.

## Direitos do titular

| Direito | Como |
|---|---|
| Confirmação, acesso e portabilidade | `GET /api/v1/me/data-export` (botão "Baixar meus dados"): cadastro, vínculos, perfis de motorista, sessões, convites e as últimas 1000 ações na auditoria, em JSON |
| Correção | Nome no perfil; dados de motorista pela transportadora |
| Eliminação/anonimização | `POST /api/v1/me/delete` com a senha. Detalhes abaixo |
| Dados de motorista | A transportadora usa `POST /api/v1/drivers/:id/anonymize` em motorista inativo. Remove nome, CPF, telefone, admissão e vínculo; o histórico (rotas, diários, despesas) fica com um rótulo neutro |
| Revogação de consentimento do suporte | O dono revoga em Configurações → Acesso do suporte |

**O que a exclusão de conta faz:**
- troca nome e e-mail por valores anônimos;
- invalida a senha e encerra sessões e vínculos;
- revoga convites pendentes e apaga tokens de redefinição de senha.

O e-mail fica livre para um novo cadastro. Lançamentos feitos pelo usuário
continuam com a empresa (controladora, com obrigação de guarda), ligados a um
identificador que não leva mais à pessoa. Quem é dono de empresa ativa precisa
antes passar a propriedade ou pedir o cancelamento da empresa (409
`ACCOUNT_OWNS_COMPANY`). O administrador da plataforma não exclui a própria
conta por aqui.

## Acesso do suporte da plataforma

O SUPER_ADMIN não vê dados das empresas. O dono pode autorizar o acesso:
- informa o motivo e o prazo (até 72 h) e pode revogar a qualquer momento;
- o suporte abre a empresa em modo somente leitura;
- cada leitura fica em `audit_logs` (`support.request`), e o dono vê a lista
  de páginas consultadas;
- revogada ou vencida, a autorização para de valer na requisição seguinte.

Detalhes em ARCHITECTURE.md §5.4.

## Medidas de segurança

Isolamento por empresa em três camadas: contexto no backend, FKs compostas e
RLS no PostgreSQL. Também:
- senhas com Argon2id;
- TLS no proxy;
- anexos privados;
- logs sem senhas, tokens ou cookies;
- backups com retenção e teste de restauração (OPERATIONS.md).

Lista completa em [SECURITY.md](SECURITY.md).

## Pendências que dependem do negócio

- Nomear o encarregado (DPO) e publicar o contato na política.
- Preencher razão social, CNPJ e data de vigência da política e revisar o
  texto com assessoria jurídica.
- Termos de uso.
- Contrato de operador (DPA) com as transportadoras e com os provedores de
  hospedagem, e-mail e armazenamento.
- Prazo de expurgo de IP e navegador na auditoria.
