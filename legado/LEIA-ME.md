# Legado

Conteúdo mantido só como histórico. Nada aqui é usado pelo projeto.

## `migrations-d1/`

As 56 migrations SQLite do tempo em que o banco era o Cloudflare D1. O schema
final delas foi convertido e vive hoje em `migrations-postgres/0000_baseline_postgres.sql`,
que é a fonte da verdade. Novas mudanças de schema entram em
`migrations-postgres/`, aplicadas com `npm run db:migrate`.

Vale guardar por dois motivos: elas documentam *por que* várias colunas existem,
e são a referência caso ainda seja preciso exportar dados do D1 antigo:

```bash
npx wrangler@4 d1 export verdemais-production --remote --output=d1-dump.sql
npm run db:importar-d1 -- d1-dump.sql
```
