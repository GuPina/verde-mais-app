# VerdeMais — migração Cloudflare/D1 → Render/Neon

Runbook e registro do que foi feito. Escrito para ser executado na ordem.

---

## 1. O que mudou, em uma frase

O app continua sendo o mesmo Hono com as mesmas ~1.200 queries. O que entrou foi
uma **camada de compatibilidade** que expõe a API do D1 por cima do Postgres, mais
um entrypoint Node e um cron. Nenhuma das 37 rotas precisou ser reescrita.

## 2. Arquivos novos

| Arquivo | Papel |
|---|---|
| `src/lib/d1-compat.ts` | Camada D1→Postgres: mesma API (`prepare/bind/first/all/run/batch`), traduz o dialeto SQLite por baixo |
| `src/server.ts` | Entrypoint Node: monta o pool do Neon, serve `public/`, repassa tudo ao app original |
| `src/cron.ts` | Tarefas agendadas (recorrências, atrasos, lembretes) — não existiam antes |
| `migrations-postgres/0000_baseline_postgres.sql` | Schema baseline: 63 tabelas, 81 FKs, 81 índices |
| `scripts/migrar-d1-para-neon.mjs` | Copia os dados do D1 para o Neon, com conferência por tabela |
| `render.yaml` | Blueprint do Render (web + cron) |

## 3. Passo a passo do deploy

```bash
# 1. Projeto no Neon — MESMA região do serviço no Render (ver §6)
#    Copie a connection string POOLED (host com "-pooler")

# 2. Cria o schema
psql "$DATABASE_URL" -f migrations-postgres/0000_baseline_postgres.sql

# 3. Exporta o D1 de produção
npx wrangler d1 export verdemais-production --remote --output=d1-dump.sql

# 4. Ensaia a migração (não escreve nada)
DATABASE_URL="..." node scripts/migrar-d1-para-neon.mjs d1-dump.sql --dry-run

# 5. Migra de verdade — sai com código 1 se alguma contagem divergir
DATABASE_URL="..." node scripts/migrar-d1-para-neon.mjs d1-dump.sql

# 6. Sobe no Render (Blueprint → render.yaml) e configure os segredos:
#    DATABASE_URL, ADMIN_PASSWORD, ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN,
#    OPENAI_API_KEY, OPENAI_BASE_URL

# 7. Confere
curl https://<app>.onrender.com/healthz     # {"status":"ok","db":"up"}
```

Rodando local:

```bash
npm ci
DATABASE_URL="postgresql://..." ADMIN_PASSWORD="algo-seu" npm run dev:node
```

## 4. O que a camada traduz

Levantado por varredura do código, não por suposição:

| Construção SQLite | Ocorrências | Vira |
|---|---:|---|
| `strftime('%Y'\|'%m'\|'%Y-%m', X)` | 282 | `substr` posicional (null-safe, sem cast) |
| `datetime('now' [, '±N unid'])` | 109 | `to_char(now() ± interval …)` |
| placeholders `?` | ~4.900 | `$1..$n` |
| `LIKE` | 69 | `ILIKE` (no SQLite o LIKE é case-insensitive) |
| `INSERT OR IGNORE` | 61 | `ON CONFLICT DO NOTHING` |
| `MIN(a,b)` / `MAX(a,b)` escalares | 26 | `LEAST` / `GREATEST` |
| `meta.last_row_id` | 45 leituras | `RETURNING id` |
| `INSERT OR REPLACE` | 9 | `ON CONFLICT (…) DO UPDATE` |
| `"texto"` com aspas duplas | 6 | `'texto'` (no PG aspas duplas são identificador) |
| `char(N)` | 40 | `chr(N)` (`char` é nome de tipo no PG) |
| `julianday(X)` | 3 | dias desde a epoch |
| `printf('%02d', x)` | 3 | `lpad` |
| `GROUP_CONCAT` / `INSTR` | 2 | `string_agg` / `position` |

Duas decisões que valem explicação:

- **Datas continuam `text`.** Manter `'YYYY-MM-DD'` preserva a ordenação lexical
  de que o código depende e devolve string no JSON, exatamente como hoje.
  Converter para `date`/`timestamptz` obrigaria a mexer nas 1.200 queries — que é
  justamente o que a camada existe para evitar. Dá para fazer depois, por módulo.
- **`REAL` virou `double precision`, não `numeric`.** O driver `pg` devolve
  `numeric` como **string**; toda a aritmética financeira passaria a concatenar
  silenciosamente. Pelo mesmo motivo a camada instala type parsers para `int8`
  (o retorno de `COUNT()`) e `numeric` — sem isso `count: 0` viraria `"0"`, que é
  *truthy* em JavaScript.

A camada também tem uma trava: antes de executar, confere se o número de
placeholders da query traduzida bate com o de parâmetros passados. Sem ela, uma
regra de tradução que engolisse um `?` produziria resultado errado em silêncio —
foi exatamente o que aconteceu com `date('now', '+' || ? || ' days')` durante o
desenvolvimento.

## 5. Validação executada

Contra um Postgres 16 real, não em teoria:

- Schema: **63 tabelas, 81 FKs, 81 índices — 0 erros** ao carregar.
- Queries: as **1.141 queries estáticas** foram extraídas do código, traduzidas e
  submetidas a `PREPARE` (valida sintaxe, tabelas e colunas).
  **1.128 passam.** As 13 restantes: 4 são artefatos do extrator (query montada em
  pedaços) e **9 já falham hoje no D1** — ver §7.
  **Incompatibilidades exclusivas do Postgres: 0.**
- Runtime: app subindo em Node contra Postgres, **79 endpoints GET** exercitados —
  nenhum erro de servidor. Fluxo de escrita testado ponta a ponta: cadastro,
  login, receita, despesa, meta, depósito, cartão com compra parcelada (limite
  caindo de 15.000 → 9.000), orçamento, recorrência, tag, reserva e conquistas.
- Dashboard (o endpoint com ~35 queries em batch, agora numa transação real):
  todos os campos numéricos voltam como `number`.
- Migração de dados: testada com FKs em ordem topológica, coluna `GENERATED`
  (`parcelas_restantes`) corretamente recalculada pelo destino e sequences
  reposicionadas.

## 6. Latência — a decisão de região

O Render **não tem região na América do Sul** (Oregon, Ohio, Virginia, Frankfurt,
Singapura). O Neon **tem** São Paulo (`aws-sa-east-1`).

Não caia na tentação de colocar o banco em São Paulo e o app na Virginia: o
dashboard faz ~35 queries por carregamento e a ~120 ms de RTT isso vira uma tela
de vários segundos. **App e banco na mesma região.** O `render.yaml` usa
`virginia`; crie o projeto Neon em `aws-us-east-1`.

O custo dessa migração é esse: hoje o Workers atende do PoP de São Paulo; no
Render o usuário brasileiro passa a ter ~130 ms de latência até o app.

## 7. Bugs pré-existentes que a migração revelou

Nove queries referenciam colunas que **não existem no schema** — elas já falham
no D1 hoje, então são caminhos de código quebrados ou nunca exercitados. Não
foram corrigidas aqui porque exigem decisão de produto (criar a coluna ou
remover a funcionalidade):

| Arquivo | Coluna inexistente |
|---|---|
| `asaas.ts` | `assinaturas.updated_at` (e lê `expira_em`, que também não existe) |
| `comparativo.ts`, `relatorio.ts` | `ia_insights.descricao` |
| `compras-fantasma.ts` | `cdi_historico.taxa_anual` |
| `metas.ts` (3×) | `valor_pago` |
| `orcamentos.ts` | `d.valor` (alias fora de escopo) |
| `reserva.ts` | `created_at` |

## 8. Alterações feitas no código da aplicação

Poucas, todas por estritismo do Postgres (e todas continuam válidas em SQLite):

- `dashboard.ts`, `ia.ts` — `GROUP BY` precisa listar as colunas projetadas; alias
  de saída não é aceito em `HAVING`.
- `comparativo.ts` — idem no agrupamento por mês.
- `conquistas.ts` — subconsultas correlacionadas passaram a usar agregados do
  escopo externo; `HAVING` com alias virou filtro na consulta externa.
- `admin.ts` — o navegador de tabelas lia `sqlite_master`; agora usa
  `information_schema`. **O console SQL do admin ainda aceita `PRAGMA`, que não
  existe no Postgres — vale revisar.**
- `auth.ts` — tipagem `Variables` no Hono (corrige os 2 erros de TypeScript que
  existiam; o build com Vite não fazia typecheck e eles passavam batido).
- `index.tsx`, `auth.ts`, `ia.ts` — os três aliases faziam `fetch()` para a
  própria aplicação. No Node isso seria o servidor abrindo conexão consigo
  mesmo; agora é despacho em processo.
- `package.json` — removidos `bcryptjs` e `jsonwebtoken` (nunca foram importados;
  a autenticação usa Web Crypto).

## 9. Segurança

Tratada na **Parte 2** deste documento, e aplicável ao Cloudflare antes da
migração.

---

# Parte 2 — Correções de segurança (aplicar ANTES de migrar)

Escritas só com Web Crypto e `fetch`, então rodam igual no Cloudflare Workers e
no Node. Podem ir para produção no D1 hoje; a migração para o Render aproveita
tudo depois.

**Nova migration:** `migrations/0056_seguranca_rate_limit.sql` (tabela
`tentativas_login`). O baseline do Postgres já foi regerado com ela — agora são
63 tabelas.

## 1. Auto-upgrade de plano — REMOVIDO

`POST /api/asaas/ativar-manual` comparava com a senha `'verdemais@admin2026'`
**hardcoded**, sem sequer fallback de variável de ambiente. Como o repositório é
público, qualquer usuário autenticado se promovia a `pro`. O endpoint foi
apagado; para conceder plano manualmente use `PATCH /admin/api/user/:id/plano`.

Verificado: `POST /api/asaas/ativar-manual` → **404**.

## 2. Painel admin

- Não existe mais senha padrão embutida. Sem `ADMIN_PASSWORD` o painel responde
  503 em vez de abrir com a senha que está no histórico do git.
- O cookie deixou de ser a própria senha e virou um **token HMAC-SHA256 com 8h
  de validade** (`src/lib/seguranca.ts`). Quem captura o cookie não descobre a
  senha, e ele expira sozinho.
- Removido o aceite por query string (`/admin?token=…`), que vazava o segredo
  em log de acesso, histórico do navegador e header `Referer`.
- Login com comparação em tempo constante.

Verificado: sem cookie → 302 · `?token=<senha>` → 302 (não autentica mais) ·
`/admin/api/*` sem auth → 401 · cookie adulterado → 401 · cookie válido → 200 ·
o cookie **não contém** a senha.

## 3. Webhook do Asaas

Passou a exigir o header `asaas-access-token` conferido contra
`ASAAS_WEBHOOK_TOKEN` — o binding já existia no tipo desde sempre, mas nunca era
lido. Comparação em tempo constante.

Verificado: sem token → 401 · token errado → 401 · token correto → 200.

> Configure o mesmo valor no painel do Asaas, em Integrações → Webhooks.

## 4. OTP: enviado de verdade, nunca devolvido

- `src/lib/email.ts` — envio pela API HTTP do **Resend** (sem dependência nova).
- `_dev_otp` **removido** das respostas de `/register` e `/resend-otp`, e também
  do frontend: o `app.js` não guarda mais o código no `localStorage` nem mostra
  a caixinha "Dev mode — Código: ******" na tela de verificação.
- Sem `RESEND_API_KEY`, o código vai para o log do servidor e a resposta diz que
  o envio falhou — o OTP nunca volta pela API.
- `generateOTP()` passou a usar `crypto.getRandomValues` com rejeição de
  amostra. Antes era `Math.random()`, que é previsível a partir de saídas
  anteriores.
- Conferência do código em tempo constante.

**Não mexi na exigência de verificação**, conforme combinado: contas existentes
seguem funcionando sem confirmar e-mail. Quando quiser ligar isso, o gancho é o
`requireAuth` em `src/routes/auth.ts`.

Variáveis novas: `RESEND_API_KEY`, `EMAIL_REMETENTE`
(ex.: `VerdeMais <nao-responda@verdemais.app>` — valide o domínio no Resend,
senão o OTP cai em spam).

## 5. Rate limiting no login

Janela deslizante de 15 min em duas chaves:

| Chave | Limite | Cobre |
|---|---:|---|
| `origem:{email}\|{ip}` | 8 falhas | força bruta contra uma conta |
| `ip:{ip}` | 30 falhas | varredura de muitas contas do mesmo IP |

Deliberadamente **não** há bloqueio só por e-mail: seria uma negação de serviço
direcionada — bastaria errar a senha de alguém 8 vezes para trancá-lo fora da
própria conta. Login bem-sucedido zera o contador. Usuário inexistente e senha
errada seguem o mesmo caminho e a mesma mensagem, para não revelar quais
e-mails têm conta.

Verificado: 8 falhas → 401 · 9ª → **429** com `Retry-After` · a vítima continua
entrando **de outro IP** → 200.

## 6. O que ainda está aberto

- O console SQL do admin (`POST /admin/api/query`) filtra com
  `startsWith('SELECT'|'PRAGMA')`. É frágil (`WITH … DELETE` passa) e `PRAGMA`
  não existe no Postgres.
- A landing page afirma "Criptografia AES-256" e "conformidade total com a
  LGPD", e exibe métricas ("+2.400 usuários", "R$ 1.2M economizados", "4.9⭐").
- A senha antiga do admin está no histórico do git: considere-a vazada e não a
  reutilize em lugar nenhum.

---

# Parte 3 — Carregamento

## O que foi medido

| | Antes | Depois |
|---|---:|---:|
| Primeiro carregamento (HTML + JS + CSS) | 1.447.242 bytes | **295.056 bytes** |
| `app.js` isolado | 1.408.235 bytes | 285.899 bytes |
| Compressão | nenhuma | gzip |
| Cache de estáticos | nenhum | `immutable` com `?v=`, ETag |
| Dashboard no servidor (35 queries) | — | **3–5 ms** |

O ponto que muda o diagnóstico: **o servidor responde o dashboard em 5 ms**. O
banco não é o gargalo e a quantidade de queries não é o problema. O tempo que o
usuário sente é payload + distância.

## O que entrou no código

`src/server.ts` ganhou compressão (`hono/compress`), `ETag` e uma política de
cache: quando a URL traz `?v=` — como o `appShell` já faz — o arquivo daquela
URL é imutável e vale cache de um ano; sem `?v=`, cai para 5 minutos com
revalidação, para não servir versão velha se alguém esquecer de trocar o
parâmetro no deploy.

## O que depende de configuração (e vale mais que o resto)

Colocar o domínio no **Cloudflare em modo proxy** na frente do Render. É grátis
e é o que recupera o desempenho que você tinha no Workers: o TLS passa a
terminar no PoP de São Paulo em vez da Virginia, e o `app.js` sai do cache do
PoP em brotli (~230 KB) sem cruzar o oceano. As regras exatas estão comentadas
no topo do `render.yaml`.

Estimativa de primeiro carregamento para um usuário em São Paulo — **estimativa,
não medição**, porque depende da conexão dele:

| Arranjo | Estimado |
|---|---|
| Render sozinho, sem compressão | ~3–5 s |
| Render sozinho, com a compressão que entrou | ~1,2–1,8 s |
| Render + Cloudflare na frente | ~0,4–0,7 s |
| Visita seguinte (estáticos em cache) | ~0,2–0,3 s |

## Duas lentidões que CDN nenhum resolve

- **Free do Render hiberna**: a primeira visita após ociosidade leva ~1 min.
  O `render.yaml` usa `starter` por isso.
- **Neon suspende o compute** após ~5 min sem query; a consulta seguinte acorda
  o banco e paga ~500 ms. Com tráfego real quase não acontece.

## Se ainda quiser mais

O dashboard dispara ~5 chamadas de API em paralelo (`dashboard`, `cartoes`,
`conquistas/novas`, `orcamentos`, `cdi/atual`). Dá para juntá-las num endpoint
só e economizar uma ida e volta, mas mexe no `app.js` de 22 mil linhas — só
vale depois que ele estiver modularizado.
