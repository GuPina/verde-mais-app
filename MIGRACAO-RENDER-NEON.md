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
| `migrations-postgres/0000_baseline_postgres.sql` | Schema baseline: 62 tabelas, 81 FKs, 80 índices |
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

- Schema: **62 tabelas, 81 FKs, 80 índices — 0 erros** ao carregar.
- Queries: as **1.140 queries estáticas** foram extraídas do código, traduzidas e
  submetidas a `PREPARE` (valida sintaxe, tabelas e colunas).
  **1.127 passam.** As 13 restantes: 4 são artefatos do extrator (query montada em
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

## 9. O que **não** foi resolvido aqui

A migração não corrige os problemas de segurança levantados na análise anterior.
Continuam pendentes e são mais urgentes que a infraestrutura:

1. `POST /api/asaas/ativar-manual` ainda compara com a string
   `'verdemais@admin2026'` **hardcoded** — qualquer usuário logado que leia o
   repositório público se promove a `pro`. Apagar o endpoint.
2. O webhook do Asaas continua sem validar assinatura.
3. O OTP ainda volta no corpo da resposta (`_dev_otp`) e nenhum e-mail é enviado.
   *Agora em Node isso ficou fácil de resolver — o ecossistema npm inteiro está
   disponível.*
4. Sem rate limiting no login.

O `render.yaml` já usa `generateValue: true` para o `ADMIN_PASSWORD` e o
`src/server.ts` **recusa subir** sem ele — o fallback hardcoded do `admin.ts`
deixou de ser alcançável em produção. Mas a senha antiga está no histórico do
git: precisa ser considerada vazada.
