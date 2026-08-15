# VerdeMais — subir no Render

Projeto Node + Postgres. Não há mais nada de Cloudflare: sem wrangler, sem
Vite/Pages, sem D1. Três dependências de runtime — `hono`,
`@hono/node-server`, `pg`.

---

## Antes de começar

Você vai precisar de:

- conta no **Neon** (banco) e no **Render** (aplicação);
- uma chave do **Resend**, com o domínio validado — sem isso o código de
  verificação de e-mail não sai;
- as chaves que já usava: `ASAAS_API_KEY` e `OPENAI_API_KEY`.

---

## 1. Banco no Neon

Crie o projeto em **`aws-us-east-1`** — a mesma região do Render lá embaixo.
Não coloque o banco em São Paulo com o app na Virginia: o dashboard faz ~35
queries por carregamento, e a ~120 ms de ida e volta isso vira uma tela de
vários segundos.

Copie a connection string **pooled** (o host tem `-pooler` no meio).

## 2. Schema

```bash
npm ci
export DATABASE_URL="postgresql://...-pooler...neon.tech/verdemais?sslmode=require"

npm run db:status     # mostra o que está pendente
npm run db:migrate    # aplica
```

São 64 tabelas. Cada migration roda em transação: se falhar no meio, nada dela
fica aplicado.

Daqui pra frente, mudanças de schema entram como arquivos novos em
`migrations-postgres/` (ex.: `0001_nova_coluna.sql`) e sobem com o mesmo
`npm run db:migrate`. Não edite uma migration já aplicada — o runner detecta
pelo hash e avisa.

## 3. Dados antigos do D1 — opcional

**Assumi que você quer trazer os usuários e lançamentos que já existem.** Se
preferir começar com o banco vazio, pule este passo inteiro.

```bash
npx wrangler@4 d1 export verdemais-production --remote --output=d1-dump.sql

npm run db:importar-d1 -- d1-dump.sql --dry-run   # ensaia, não escreve
npm run db:importar-d1 -- d1-dump.sql             # vale
```

O script respeita a ordem das foreign keys, ignora colunas geradas, reposiciona
as sequences e confere a contagem tabela a tabela — sai com erro se algo
divergir. É a única coisa que ainda toca na Cloudflare, e só uma vez.

## 4. Aplicação no Render

Painel do Render → **New → Blueprint** → aponte para o repositório. Ele lê o
`render.yaml` e cria dois serviços: o web e o cron.

Preencha os segredos (o `ADMIN_PASSWORD` o próprio Render gera):

| Variável | Observação |
|---|---|
| `DATABASE_URL` | a connection string pooled do passo 1 |
| `RESEND_API_KEY` | com domínio validado |
| `EMAIL_REMETENTE` | ex.: `VerdeMais <nao-responda@verdemais.app>` |
| `ASAAS_API_KEY` | |
| `ASAAS_WEBHOOK_TOKEN` | **configure o mesmo valor no painel do Asaas** |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | |

## 5. Conferir

```bash
curl https://<seu-app>.onrender.com/healthz     # {"status":"ok","db":"up"}
```

Depois, no navegador: cadastre uma conta e confirme que **o código chega por
e-mail** — não deve aparecer nada na tela nem na resposta da API.

## 6. Depois do primeiro deploy

- **Troque o webhook no Asaas** para a URL do Render e coloque o
  `ASAAS_WEBHOOK_TOKEN` no header `asaas-access-token`. Sem isso os pagamentos
  param de ativar plano — e com token errado o endpoint agora devolve 401, o
  que é o comportamento correto, mas você precisa saber que é isso.
- **Considere um CDN na frente** se quiser o carregamento próximo do que era no
  edge. O `src/server.ts` já manda `Cache-Control: immutable` quando a URL traz
  `?v=`, e o `src/lib/seguranca.ts` lê `CF-Connecting-IP`/`X-Forwarded-For`, então
  o rate limiting continua vendo o IP real do usuário atrás do proxy.
- **A senha antiga do admin está no histórico do git.** Considere-a vazada e não
  a reutilize em lugar nenhum.

---

## Rodando local

```bash
npm ci
export DATABASE_URL="postgresql://..."
export ADMIN_PASSWORD="algo-seu"
npm run db:migrate
npm run dev            # tsx watch, recarrega ao salvar
```

Sem `ADMIN_PASSWORD` o servidor **se recusa a subir** — de propósito: antes
existia uma senha padrão embutida no código.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor local com reload |
| `npm run build` | empacota `dist-node/server.js` e `cron.js` |
| `npm start` | roda o build (é o que o Render usa) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:status` | migrations pendentes |
| `npm run db:migrate` | aplica as pendentes |
| `npm run db:importar-d1` | importa um dump do D1 antigo |
| `npm run cron` | roda as tarefas agendadas na mão |

## Estrutura

```
src/
├── server.ts            entrypoint Node: pool do Neon, estáticos, compressão
├── cron.ts              recorrências, atrasos e lembretes
├── index.tsx            app Hono: rotas, landing e shell da SPA
├── lib/
│   ├── d1-compat.ts     camada Postgres com a API que as ~1.200 queries usam
│   ├── seguranca.ts     HMAC, comparação em tempo constante, IP real
│   ├── email.ts         envio via Resend
│   └── auth.ts          PBKDF2
├── routes/              37 routers
└── types/globais.d.ts   D1Database e afins, sem depender da Cloudflare

migrations-postgres/     schema (fonte da verdade)
scripts/                 migrate.mjs · migrar-d1-para-neon.mjs
legado/migrations-d1/    as 56 migrations SQLite antigas, só histórico
```
