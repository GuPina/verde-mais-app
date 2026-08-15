# VerdeMais — SaaS de Finanças Pessoais

Plataforma de gestão financeira pessoal com gamificação, IA conversacional e
análise preditiva.

- **Stack**: Hono + TypeScript + Node 22 + Postgres (Neon), hospedado no Render
- **Frontend**: SPA em JavaScript puro (`public/static/app.js`, ~22,6k linhas)
- **Backend**: 37 routers em `src/routes/*.ts`, ~300 endpoints
- **Banco**: 64 tabelas — schema em `migrations-postgres/`
- **Versão**: 3.1.0

Para subir o projeto, veja **[DEPLOY.md](DEPLOY.md)**.

> Histórico: até a v3.1 o projeto rodava em Cloudflare Workers + D1. A migração
> para Node + Postgres está documentada em
> [MIGRACAO-RENDER-NEON.md](MIGRACAO-RENDER-NEON.md); as migrations SQLite
> antigas ficaram em `legado/migrations-d1/`.

---

## Planos

| Plano   | Preço      | Funcionalidades principais                              |
|---------|------------|---------------------------------------------------------|
| FREE    | Gratuito   | Receitas, Despesas, Metas (3), Cartões (1), Lembretes  |
| PREMIUM | R$ 19/mês  | + Score Saúde, Projeção, Relatório Anual, Simulações   |
| PRO     | R$ 49/mês  | + Sem limites, IA Insights, Export PDF, Amortização    |

---

## Funcionalidades Implementadas (v3.0 Fase 3B+3C+4)

### BLOCO 1 — Correções Críticas ✅
- **BUG 1.1** — Investimentos tipo "Aporte": campo `tipo='aporte'` na tabela `despesas`, excluído dos cálculos 50/30/20 e somado à poupança
- **BUG 1.2** — Amortização SAC/PRICE: fórmulas corrigidas (SAC reduzir prazo, PRICE com proteção contra divisão por zero)
- **BUG 1.3** — Tabelas órfãs: migration 0012 remove `cartao_lancamentos`, `despesas_new`, `investimentos_new`
- **BUG 1.4** — Conquistas: `quitou_imovel` (500pts, lendário) acionada no fluxo de financiamentos quitados
- **BUG 1.5** — API despesas compartilhadas: CRUD completo em `src/routes/despesas-compartilhadas.ts`
- **BUG 1.6** — Health check: versão `3.0.0`, fase `3B+3C+4`

### BLOCO 2 — Melhorias Alta Prioridade ✅
- **2.1** — Dashboard: `patrimonio_bruto`, `patrimonio_liquido`, `alerta_assinaturas`, `desafio_52`, `reservas_esp`
- **2.2** — Modal Nova Despesa: campos de alerta, tags, detector de recorrência (via `tipo='aporte'` e campos extras)
- **2.3** — Projeção determinística: parcelas futuras pendentes + recorrências ativas + lembretes com valor
- **2.4** — Comparativo mensal: receitas, despesas, saldo e insights por categoria

### BLOCO 3 — Melhorias Média Prioridade ✅
- **3.1** — Desafio 52 configurável: `desafio_config` (valor_base, multiplicador, modo_invertido)
- **3.2** — Regra 50/30/20 editável: `regra_config` com percentuais customizáveis
- **3.3** — Tags ampliadas para receitas (`receita_tags`) e card "Top Gastos por Tag"

### BLOCO 4 — Novas Conquistas ✅
22 novas conquistas via migrations 0014/0016 incluindo:
`saldo_verde`, `zero_cartao`, `barreira_10k`, `barreira_50k`, `barreira_100k`, `livre_banco`, `quitou_imovel`, `realizador`, etc.

### BLOCO 5 — Assistente IA Conversacional ✅
- **Backend**: POST `/api/assistente/chat` com 11 intenções detectadas
- **Intenções**: saldo, metas, investimentos, dívidas, planejamento, conquistas, desafio, assinaturas, reservas, regra503020, ajuda
- **Frontend**: página estilo chat com sugestões rápidas e histórico em `assistente_conversas`

### BLOCO 6 — Integrações entre Módulos ✅
- Detector → Recorrências (despesas com tipo detectado criam recorrência)
- Regra 50/30/20 → Orçamentos (recomendações automáticas)
- Projeção → Metas (alerta de viabilidade)
- Desafio 52 → Metas (progresso vinculado)
- Reservas → Metas (linked_meta_id)

---

## Endpoints API

### Autenticação
| Método | Endpoint                  | Descrição                         |
|--------|---------------------------|-----------------------------------|
| POST   | /api/auth/register        | Criar conta                       |
| POST   | /api/auth/login           | Login                             |
| POST   | /api/auth/verify-otp      | Verificar OTP (email, code)       |
| POST   | /api/auth/logout          | Logout                            |
| GET    | /api/auth/me              | Dados do usuário logado           |

### Dashboard & Análise
| Método | Endpoint                     | Plano     | Descrição                              |
|--------|------------------------------|-----------|----------------------------------------|
| GET    | /api/dashboard               | FREE+     | Resumo financeiro completo             |
| GET    | /api/dashboard/relatorio     | PREMIUM+  | Relatório anual mensal                 |
| GET    | /api/comparativo             | FREE+     | Comparativo mês atual vs anterior      |
| GET    | /api/projecao                | PREMIUM+  | Projeção 12 meses determinística       |
| GET    | /api/regra-503020            | FREE+     | Análise e score da regra 50/30/20      |
| GET    | /api/regra-503020/config     | FREE+     | Configuração personalizada             |
| POST   | /api/regra-503020/config     | FREE+     | Salvar configuração                    |

### Receitas & Despesas
| Método | Endpoint                     | Descrição                         |
|--------|------------------------------|-----------------------------------|
| GET    | /api/receitas                | Listar receitas do mês            |
| POST   | /api/receitas                | Criar receita                     |
| PUT    | /api/receitas/:id            | Editar receita                    |
| DELETE | /api/receitas/:id            | Remover receita                   |
| GET    | /api/despesas                | Listar despesas do mês            |
| POST   | /api/despesas                | Criar despesa (tipo: aporte/normal)|
| PUT    | /api/despesas/:id            | Editar despesa                    |
| DELETE | /api/despesas/:id            | Remover despesa                   |

### Módulos Financeiros
| Método | Endpoint                           | Descrição                         |
|--------|------------------------------------|-----------------------------------|
| GET    | /api/investimentos                 | Listar investimentos              |
| POST   | /api/investimentos                 | Criar investimento (aporte)       |
| GET    | /api/metas                         | Listar metas                      |
| GET    | /api/emprestimos                   | Listar empréstimos                |
| GET    | /api/financiamentos                | Listar financiamentos             |
| GET    | /api/cartoes                       | Listar cartões                    |
| GET    | /api/lembretes                     | Listar lembretes                  |
| GET    | /api/orcamentos                    | Listar orçamentos                 |
| GET    | /api/reservas-esp                  | Reservas especializadas           |
| GET    | /api/assinaturas-fantasma          | Assinaturas detectadas            |
| GET    | /api/despesas-compartilhadas       | Despesas compartilhadas           |

### Ferramentas & IA
| Método | Endpoint                     | Plano     | Descrição                              |
|--------|------------------------------|-----------|----------------------------------------|
| POST   | /api/assistente/chat         | FREE+     | Assistente IA conversacional           |
| GET    | /api/conquistas              | FREE+     | Conquistas e pontuação                 |
| GET    | /api/tags                    | FREE+     | Tags de categorias                     |
| POST   | /api/amortizacao/simular     | PRO       | Simulação SAC/PRICE                    |
| GET    | /api/amortizacao/historico   | PRO       | Histórico de simulações                |
| GET    | /api/desafio-52              | FREE+     | Status do desafio 52 semanas           |
| GET    | /api/desafio-52/config       | FREE+     | Configuração do desafio                |
| POST   | /api/desafio-52/config       | FREE+     | Salvar configuração                    |
| GET    | /api/cdi                     | FREE+     | Taxa CDI atual (BCB)                   |
| GET    | /api/relatorio               | PRO       | Relatório detalhado                    |
| GET    | /api/alertas-cartao          | FREE+     | Alertas de fatura do cartão            |
| GET    | /api/ia                      | PREMIUM+  | Insights gerados por IA                |
| GET    | /api/health                  | —         | Health check (versão, fase)            |

---

## Estrutura de Dados

### Tabelas Principais (64 total)
```
users, sessions, email_verifications
receitas, despesas, despesa_tags
investimentos
metas
emprestimos, financiamentos, pagamentos
cartoes, card_charges, alertas_cartao
lembretes, lembretes_historico
orcamentos
recorrencias
reserva_emergencia, specialized_reserves, reserve_transactions
detected_subscriptions
weekly_challenges, desafio_config
regra_config
tags, receita_tags
conquistas_definicoes, conquistas_usuario
ia_insights
assistente_conversas
shared_expenses
cdi_historico
amortization_simulations
assinaturas
```

### Campo `tipo` em despesas (BUG 1.1 corrigido)
- `normal` — despesa comum (contabilizada no 50/30/20)
- `aporte` — investimento/transferência patrimonial (excluída das despesas, somada à poupança)

---

## Como Executar

```bash
npm ci
export DATABASE_URL="postgresql://..."
export ADMIN_PASSWORD="algo-seu"
npm run db:migrate
npm run dev
```

Detalhes e deploy: [DEPLOY.md](DEPLOY.md).

---

## Status do Projeto

| Fase      | Status  | Descrição                                          |
|-----------|---------|----------------------------------------------------|
| 3A        | ✅ Done  | Reservas esp., Assinaturas fantasma, Desafio 52    |
| 3B        | ✅ Done  | BUGs 1.1–1.6, Melhorias 2.1–2.4                   |
| 3C        | ✅ Done  | Desafio configurável, Regra editável, Tags receitas|
| 4         | ✅ Done  | Assistente IA, Integrações entre módulos           |
| **Atual** | **3B+3C+4** | Todas as fases concluídas                      |

**Última atualização**: 2026-08-15
