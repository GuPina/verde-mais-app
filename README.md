# 💚 VerdeMais — Mentor Financeiro Digital

> **Organize hoje. Conquiste amanhã.**

VerdeMais é uma plataforma SaaS completa de gestão financeira pessoal. Mais do que um app de controle, é um **Mentor Financeiro Digital** que organiza, analisa, orienta e ajuda a construir patrimônio.

---

## 🌐 URLs

| Ambiente | URL |
|---|---|
| **App (Produção)** | Em breve após deploy |
| **API Health** | `/api/health` |
| **Landing Page** | `/` |
| **Login** | `/login` |
| **Cadastro** | `/cadastro` |
| **Dashboard** | `/app/dashboard` |

---

## ✅ Funcionalidades Implementadas (v1.0)

### 🏠 Landing Page Pública
- Hero com mockup do dashboard
- Seção de funcionalidades
- Comparação de planos (Free / Premium / Pro)
- FAQ
- Seção de segurança
- Rodapé institucional

### 🔐 Autenticação
- Cadastro com criptografia de senha (PBKDF2 + SHA-256)
- Login com token de sessão (7 dias)
- Logout seguro
- Proteção de rotas via middleware

### 📊 Dashboard
- Saldo do mês
- Total de receitas e despesas
- Score de saúde financeira (0-100)
- Gráfico de evolução 6 meses (Chart.js)
- Gráfico de categorias (Doughnut)
- Últimas transações
- Alertas de vencimento próximo

### 💰 Receitas
- Adicionar / Editar / Excluir
- Categorias: Salário, Freelance, Investimentos, Aluguel, Vendas, Bônus, Outros
- Filtros por mês/ano
- Receitas recorrentes

### 💸 Despesas
- Adicionar / Editar / Excluir
- **Parcelamento automático** (gera N parcelas em meses consecutivos)
- Despesas fixas e variáveis
- Status: Pago / Pendente (toggle rápido)
- Alertas de vencimento
- Filtros por mês, ano e status

### 🎯 Metas Financeiras
- Criar metas com valor, prazo e cor
- Barra de progresso visual
- Cálculo automático de mensalidade necessária
- Depósitos com atualização de progresso
- Marcação automática como "Concluída"

### 📈 Investimentos
- Tipos: Tesouro Direto, CDB, LCI, LCA, Ações, FII, Cripto, Poupança
- Resumo de patrimônio total
- Rentabilidade e lucro/prejuízo
- Níveis de risco (baixo, médio, alto)

### 🧮 Simulações
- Simulador de investimentos educacional
- Taxas: Poupança, CDB, LCI/LCA, Tesouro Direto, FII, Ações, Cripto
- Prazos: 6 meses até 10 anos
- Gráfico de projeção de crescimento
- Detalhamento por trimestre

### 📋 Relatórios
- Evolução anual mês a mês
- Gráfico de linha comparativo
- Tabela com status (positivo/negativo)
- Totais anuais

---

## 🔒 Pendente / Próximos Passos

- [ ] Exportação de relatórios em PDF
- [ ] Integração com Stripe para assinaturas
- [ ] IA financeira personalizada (Plano Pro)
- [ ] Open Banking / integração bancária
- [ ] Regra 50/30/20 personalizada
- [ ] Projeção patrimonial 5 anos
- [ ] App mobile nativo
- [ ] Dark/Light mode toggle
- [ ] Notificações por email

---

## 🏗️ Arquitetura

```
verdemais/
├── src/
│   ├── index.tsx          # Entry point Hono + Landing + App Shell
│   ├── lib/
│   │   └── auth.ts        # Criptografia com Web Crypto API
│   └── routes/
│       ├── auth.ts        # /api/auth/*
│       ├── receitas.ts    # /api/receitas/*
│       ├── despesas.ts    # /api/despesas/*
│       ├── metas.ts       # /api/metas/*
│       ├── investimentos.ts  # /api/investimentos/*
│       └── dashboard.ts   # /api/dashboard/*
├── public/static/
│   ├── app.js             # SPA Frontend (Vanilla JS)
│   └── app.css            # Estilos customizados
├── migrations/
│   └── 0001_initial_schema.sql
├── wrangler.jsonc
└── ecosystem.config.cjs   # PM2 config
```

---

## 🗄️ Banco de Dados (Cloudflare D1)

| Tabela | Descrição |
|---|---|
| `users` | Usuários com plano e perfil |
| `sessions` | Tokens de autenticação |
| `receitas` | Entradas financeiras |
| `despesas` | Saídas com suporte a parcelamento |
| `metas` | Objetivos financeiros |
| `investimentos` | Portfólio de investimentos |
| `assinaturas` | Planos SaaS (Free/Premium/Pro) |

---

## 💰 Planos SaaS

| Plano | Preço | Recursos |
|---|---|---|
| **Free** | Grátis | Dashboard, controle básico, 3 metas |
| **Premium** | R$ 19/mês | Score financeiro, simulações, relatórios avançados |
| **Pro** | R$ 49/mês | IA financeira, projeção 5 anos, API access |

---

## 🚀 Stack Tecnológica

- **Backend**: Hono.js + Cloudflare Workers
- **Banco de Dados**: Cloudflare D1 (SQLite)
- **Frontend**: Vanilla JS + Tailwind CSS (CDN)
- **Gráficos**: Chart.js
- **HTTP Client**: Axios
- **Build**: Vite + @hono/vite-build
- **Deploy**: Cloudflare Pages

---

## 🔑 Conta de Demonstração

```
Email: gustavo@verdemais.app
Senha: 123456
```

---

## 🛠️ Comandos

```bash
# Desenvolvimento
npm run build           # Build do projeto
pm2 start ecosystem.config.cjs  # Iniciar servidor

# Banco de dados
npm run db:migrate:local   # Aplicar migrations local
npm run db:reset           # Resetar banco local

# Deploy
npm run deploy:prod        # Deploy para Cloudflare Pages
```

---

*VerdeMais © 2026 — Feito com 💚 no Brasil*
