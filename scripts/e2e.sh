#!/usr/bin/env bash
# Sobe Postgres + app em descartável, roda os fluxos, derruba tudo.
#
# Recusa rodar com DATABASE_URL definida: este script cria e apaga banco, e um
# engano aqui custaria dados de produção.
set -euo pipefail

if [ -n "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL está definida. Este script cria banco descartável e apaga no fim."
  echo "  Rode num shell sem DATABASE_URL."; exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORTA_PG="${PORTA_PG:-5441}"
PORTA_APP="${PORTA_APP:-3301}"
DIR="$(mktemp -d /var/tmp/vm-e2e-XXXXXX)"
APP_PID=""

limpar() {
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
  su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap limpar EXIT

echo "── banco descartável em $DIR"
chown postgres:postgres "$DIR"
su postgres -c "$PGBIN/initdb -D $DIR/data -U vm --auth=trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORTA_PG -k $DIR' -l $DIR/log start" >/dev/null
sleep 2
su postgres -c "$PGBIN/psql -h $DIR -p $PORTA_PG -U vm -d postgres -q -c 'CREATE DATABASE vm'"

export DATABASE_URL="postgres://vm@127.0.0.1:$PORTA_PG/vm"
echo "── build e servidor na porta $PORTA_APP"
npm run build --silent
PORT="$PORTA_APP" ADMIN_PASSWORD="e2e-descartavel-$RANDOM" node "$RAIZ/dist-node/server.js" > "$DIR/app.log" 2>&1 &
APP_PID=$!
pronto=0
for _ in $(seq 1 120); do
  if curl -sf "http://localhost:$PORTA_APP/" >/dev/null 2>&1; then pronto=1; break; fi
  # Se o processo morreu, não adianta esperar: mostra o log e sai.
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "✗ o servidor morreu antes de responder:"; tail -20 "$DIR/app.log"; exit 1
  fi
  sleep 0.5
done
if [ "$pronto" != "1" ]; then
  echo "✗ o servidor não respondeu em 60s:"; tail -20 "$DIR/app.log"; exit 1
fi
# O servidor só escuta depois de aplicar as migrations — esperar o socket é
# esperar o schema. Sem esta checagem a semente roda num banco vazio e falha
# com "relation users does not exist", que parece bug do app e é corrida.
su postgres -c "$PGBIN/psql -h $DIR -p $PORTA_PG -U vm -d vm -tAc \"SELECT to_regclass('public.users')\"" \
  | grep -q users || { echo "✗ migrations não criaram o schema:"; tail -20 "$DIR/app.log"; exit 1; }

echo "── semeando usuário e histórico"
node "$RAIZ/tests/e2e/semear.mjs"
# shellcheck disable=SC1091
set -a; . /tmp/vm-e2e-cred.env; set +a

echo "── fluxos"
E2E_BASE="http://localhost:$PORTA_APP/api" node --test "$RAIZ/tests/e2e/fluxos.mjs"
