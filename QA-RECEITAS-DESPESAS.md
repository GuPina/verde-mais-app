# QA Receitas e Despesas — Auditoria ajustada

Data: 28/08/2026

## Receitas

Status geral: os 12 achados funcionais/técnicos foram corrigidos. As 4 ideias seguem como backlog de produto.

| Ponto | Status | Resultado |
|---|---|---|
| R1 | Corrigido | Limite do plano agora conta o mês do lançamento, não o mês atual do calendário. |
| R2 | Corrigido | Duplicar receita abre criação real e evita `PUT /api/receitas/undefined`. |
| R3 | Corrigido | Valor zero/negativo é recusado. |
| R4 | Corrigido | Descrição só com espaços é recusada. |
| R5 | Corrigido | `limit` inválido retorna 400 em vez de 500. |
| R6 | Corrigido | `DELETE /api/receitas/abc` retorna 400 em vez de 500. |
| R7 | Corrigido | Bulk delete valida IDs antes de tocar no banco. |
| R8 | Corrigido | Descrição limitada a 500 caracteres e valor limitado a R$ 1 bilhão. |
| R9 | Corrigido | Tag automática de categoria acompanha troca de categoria. |
| R10 | Corrigido | Totais são arredondados para centavos. |
| R11 | Corrigido | Filtro ganhou “Todos” e seletor de ano ficou dinâmico. |
| R12 | Corrigido | Modal de duplicação mostra fluxo de nova receita. |
| R13 | Backlog | Receita prevista vs. recebida. |
| R14 | Backlog | Recorrência real gerando próximos meses. |
| R15 | Backlog | Agrupamento por fonte pagadora. |
| R16 | Backlog | Alerta de queda de renda. |

## Despesas

Status geral: os principais problemas funcionais foram corrigidos; a edição de série parcelada inteira segue como backlog maior.

| Ponto | Status | Resultado |
|---|---|---|
| DP1 | Corrigido | Competência de despesas pagas usa `data_pagamento`; pendentes usam vencimento/data. |
| DP2 | Corrigido | Canceladas ficam fora dos totais ativos por padrão e agora podem ser filtradas. |
| DP3 | Corrigido | Duplicar despesa abre criação real e evita `PUT /api/despesas/undefined`. |
| DP4 | Corrigido | Aporte patrimonial é gravado via `tipo='aporte'` e sai dos totais/despesas. |
| DP5 | Corrigido | `PATCH /api/despesas/:id` aceita edição parcial além de status. |
| DP6 | Corrigido | `status` e `meio_pagamento` inválidos retornam 400. |
| DP7 | Corrigido | Paginação, delete e bulk com IDs inválidos retornam 400. |
| DP8 | Corrigido | Descrição só com espaços é recusada. |
| DP9 | Ajustado | “Pagar todas pendentes” funciona por mês ou pelo ano inteiro quando mês = Todos. |
| DP10 | Corrigido | Limite do plano conta o mês do lançamento. |
| DP11 | Corrigido | Parcelado sem `numero_parcelas` é recusado. |
| DP12 | Corrigido | Marcar como pago pergunta a data; formulário também mostra data de pagamento. |
| DP13 | Mitigado | Após pagar todas, é possível filtrar por Pago e reverter itens selecionados para Pendente. |
| DP14 | Backlog | Criar fluxo para editar uma série inteira de parcelamento. |

## Validações adicionadas ao QA

- Testar mês “Todos” em Receitas e Despesas.
- Testar status “Cancelado” em Despesas e confirmar que não entra em totais ativos.
- Testar duplicação de Receita/Despesa e confirmar POST, não PUT com ID indefinido.
- Testar baixa de despesa individual e em lote escolhendo data de pagamento.
- Testar APIs com `limit=-5`, IDs não numéricos e bulk com IDs inválidos.
