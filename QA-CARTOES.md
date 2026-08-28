# QA — Cartões

Data: 2026-08-28

## Escopo desta rodada

- Aplicar o UX Terminal v3.0 na tela de Cartões.
- Corrigir os principais pontos funcionais levantados na auditoria de Cartões.
- Garantir que Receitas e Despesas também usem o novo shell visual financeiro.

## Correções aplicadas

1. Cartões entrou no mesmo shell visual Terminal de Dashboard, Receitas e Despesas.
2. Cards de cartão redesenhados com hierarquia por limite total, usado, livre, vencimento e estado de alerta.
3. Banner de faturas redesenhado com KPIs compactos.
4. Removido botão de “ajustar limite disponível”, porque o limite disponível é derivado das faturas em aberto.
5. Criação de cartão agora valida dias de vencimento/fechamento entre 1 e 31.
6. Edição de cartão agora rejeita limite inválido, dia inválido e bandeira fora do enum.
7. Limite zero agora retorna erro específico, não mensagem genérica de campo obrigatório.
8. Cálculo de fechamento respeita último dia real do mês quando o cartão fecha em 29, 30 ou 31.
9. Abrir fatura não avança mais automaticamente para meses futuros quando a fatura atual está vazia.
10. Exclusão de cartão virou arquivamento lógico: o cartão sai da lista, mas as despesas históricas são preservadas.
11. `GET /api/cartoes/:id/lancamentos` agora retorna 404 para cartão inexistente ou de outro usuário.
12. Rotas legadas de lançamentos receberam validação de valor, data e quantidade de parcelas.
13. Rotas legadas também respeitam limite disponível antes de criar compras.
14. Limite por categoria inexistente agora retorna 404 ao excluir.
15. Service worker teve cache versionado e passou a incluir `terminal-dashboard.css`.
16. Service worker duplicado foi limpo para evitar comportamento instável de cache.

## Ideias de melhoria/backlog

- Arquivo de cartões arquivados, com opção de restaurar cartão.
- “Quanto vou pagar no próximo vencimento?” com soma por data e cartão.
- “Melhor dia para comprar” com base em fechamento e vencimento.
- Simulação de impacto no limite antes de parcelar uma compra.
- Alerta preventivo quando uma compra parcelada ultrapassar orçamento da categoria.
- Linha do tempo da fatura: compra, fechamento, vencimento, pagamento.
- Reconciliação de fatura: comparar fatura fechada com lançamentos do cartão.

## QA técnico executado

- `node --check public/static/app.js`
- `node --check public/sw.js`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

