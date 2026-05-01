#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# test_conquistas.sh — Suite de testes: Módulo Conquistas
# Rotas testadas:
#   GET  /api/conquistas
#   PATCH /api/conquistas/visualizar
#   GET  /api/conquistas/novas
#   POST /api/conquistas/verificar
#   POST /api/conquistas/reprocessar
#
# Validações extras:
#   - Consistência engine ↔ DB (códigos órfãos)
#   - Todos os códigos da engine existem na tabela conquistas_definicoes
#   - Todos os códigos do DB são verificados pela engine
#   - Progresso parcial retornado pelo GET /
# ══════════════════════════════════════════════════════════════════════════════

BASE="http://localhost:3000"
PASS=0; FAIL=0; SKIP=0
FAILED_TESTS=()

ok()   { echo "  ✅ $1"; ((PASS++)); }
fail() { echo "  ❌ $1"; ((FAIL++)); FAILED_TESTS+=("$1"); }
skip() { echo "  ⏭  $1"; ((SKIP++)); }
hdr()  { echo; echo "── $1 ──"; }

assert_status() {
  local label="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then ok "$label — HTTP $want"; else fail "$label — esperado $want, obtido $got"; fi
}

assert_true() {
  local label="$1" body="$2" expr="$3"
  if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert $expr" 2>/dev/null; then
    ok "$label"
  else
    fail "$label"
  fi
}

assert_field() {
  local label="$1" body="$2" field="$3"
  if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in d" 2>/dev/null; then
    ok "$label — campo '$field' presente"
  else
    fail "$label — campo '$field' ausente"
  fi
}

# ── SETUP ────────────────────────────────────────────────────────────────────
echo "═══ SETUP ════════════════════════════════════════════════════════════════"

# user 7 (conquistas_test@verdemais.app — premium — dados ricos)
LOGIN7=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"conquistas_test@verdemais.app","senha":"Senha123!"}')
TOK7=$(echo "$LOGIN7" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)

# user 45 (sim_pro@test.com — pro — dados mínimos)
LOGIN45=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"sim_pro@test.com","senha":"Senha123!"}')
TOK45=$(echo "$LOGIN45" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)

# user 46 (sim_free@test.com — free)
LOGIN46=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"sim_free@test.com","senha":"Senha123!"}')
TOK46=$(echo "$LOGIN46" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)

if [[ -n "$TOK7"  ]]; then echo "  ✔ user7  (conquistas_test) autenticado"; else echo "  ✗ user7 falhou — abortando"; exit 1; fi
if [[ -n "$TOK45" ]]; then echo "  ✔ user45 (sim_pro)         autenticado"; else echo "  ✗ user45 falhou — abortando"; exit 1; fi
if [[ -n "$TOK46" ]]; then echo "  ✔ user46 (sim_free)        autenticado"; else echo "  ✗ user46 falhou — abortando"; exit 1; fi

# ── Pré-carregar dados para user 46 (sem conquistas ainda) ──────────────────
# Limpa conquistas anteriores do user 46 para testes limpos
cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="DELETE FROM conquistas_usuario WHERE user_id=46" 2>/dev/null >/dev/null

# Garantir que user 46 tem ao menos 1 despesa, 1 receita e 1 meta (dados mínimos)
DESP46=$(cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="SELECT COUNT(*) as cnt FROM despesas WHERE user_id=46" 2>/dev/null | grep '"cnt"' | grep -o '[0-9]*' | head -1)
if [[ "${DESP46:-0}" -lt 1 ]]; then
  cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
    --command="INSERT INTO despesas (user_id, descricao, valor, categoria, data, status) VALUES (46,'Teste conquista',100,'Outros','2026-04-01','pago')" 2>/dev/null >/dev/null
fi

REC46=$(cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="SELECT COUNT(*) as cnt FROM receitas WHERE user_id=46" 2>/dev/null | grep '"cnt"' | grep -o '[0-9]*' | head -1)
if [[ "${REC46:-0}" -lt 1 ]]; then
  cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
    --command="INSERT INTO receitas (user_id, descricao, valor, categoria, data) VALUES (46,'Salário teste',1000,'Salário','2026-04-01')" 2>/dev/null >/dev/null
fi

echo "  ✔ dados de user46 verificados"

# ══════════════════════════════════════════════════════════════════════════════
# CO-A  Autenticação — todos os endpoints exigem auth
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-A — Autenticação"

A1=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/conquistas")
assert_status "CO-A1 — GET / sem token → 401" "$A1" "401"

A2=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/conquistas/visualizar")
assert_status "CO-A2 — PATCH /visualizar sem token → 401" "$A2" "401"

A3=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/conquistas/novas")
assert_status "CO-A3 — GET /novas sem token → 401" "$A3" "401"

A4=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/conquistas/verificar" -H "Content-Type: application/json" -d '{}')
assert_status "CO-A4 — POST /verificar sem token → 401" "$A4" "401"

A5=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/conquistas/reprocessar" -H "Content-Type: application/json" -d '{}')
assert_status "CO-A5 — POST /reprocessar sem token → 401" "$A5" "401"

# ══════════════════════════════════════════════════════════════════════════════
# CO-B  GET /api/conquistas — estrutura da resposta
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-B — GET /api/conquistas: estrutura"

GET7=$(curl -s "$BASE/api/conquistas" -H "Authorization: Bearer $TOK7")

assert_field "CO-B1 — campo 'conquistas'"         "$GET7" "conquistas"
assert_field "CO-B2 — campo 'total_conquistadas'" "$GET7" "total_conquistadas"
assert_field "CO-B3 — campo 'total_disponivel'"   "$GET7" "total_disponivel"
assert_field "CO-B4 — campo 'total_pontos'"       "$GET7" "total_pontos"
assert_field "CO-B5 — campo 'nao_visualizadas'"   "$GET7" "nao_visualizadas"

# conquistas deve ser array não-vazio
assert_true "CO-B6 — conquistas é lista não-vazia" "$GET7" "len(d['conquistas']) > 0"

# total_disponivel deve bater com total de definições no banco (195)
assert_true "CO-B7 — total_disponivel = 195 definições" "$GET7" "d['total_disponivel'] == 195"

# total_conquistadas deve ser >= 1 (user7 tem muitas)
assert_true "CO-B8 — total_conquistadas >= 1 para user7" "$GET7" "d['total_conquistadas'] >= 1"

# pontos deve ser > 0
assert_true "CO-B9 — total_pontos > 0 para user7" "$GET7" "d['total_pontos'] > 0"

# ══════════════════════════════════════════════════════════════════════════════
# CO-C  GET /api/conquistas — campos de cada item
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-C — GET /api/conquistas: campos por item"

assert_true "CO-C1 — item tem 'codigo'"       "$GET7" "'codigo' in d['conquistas'][0]"
assert_true "CO-C2 — item tem 'titulo'"       "$GET7" "'titulo' in d['conquistas'][0]"
assert_true "CO-C3 — item tem 'descricao'"    "$GET7" "'descricao' in d['conquistas'][0]"
assert_true "CO-C4 — item tem 'pontos'"       "$GET7" "'pontos' in d['conquistas'][0]"
assert_true "CO-C5 — item tem 'raridade'"     "$GET7" "'raridade' in d['conquistas'][0]"
assert_true "CO-C6 — item tem 'conquistada'"  "$GET7" "'conquistada' in d['conquistas'][0]"
assert_true "CO-C7 — item tem 'visualizado'"  "$GET7" "'visualizado' in d['conquistas'][0]"
assert_true "CO-C8 — item tem 'progresso' (pode ser null)" "$GET7" "'progresso' in d['conquistas'][0]"

# Verificar que 'conquistada' é bool
assert_true "CO-C9 — conquistada é bool"      "$GET7" "isinstance(d['conquistas'][0]['conquistada'], bool)"

# ══════════════════════════════════════════════════════════════════════════════
# CO-D  GET /api/conquistas — progresso parcial
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-D — GET /api/conquistas: progresso parcial"

# Conquistadas com progresso devem ter campos atual/total/pct
PROG_BODY=$(echo "$GET7" | python3 -c "
import sys, json
d = json.load(sys.stdin)
itens_com_prog = [c for c in d['conquistas'] if c.get('progresso') is not None]
print(json.dumps({'itens_com_prog': itens_com_prog[:3], 'count': len(itens_com_prog)}))
" 2>/dev/null)

assert_true "CO-D1 — pelo menos 1 conquista com progresso" "$PROG_BODY" "d['count'] >= 1"
assert_true "CO-D2 — progresso tem campo 'atual'" "$PROG_BODY" "d['count'] == 0 or 'atual' in d['itens_com_prog'][0]['progresso']"
assert_true "CO-D3 — progresso tem campo 'total'" "$PROG_BODY" "d['count'] == 0 or 'total' in d['itens_com_prog'][0]['progresso']"
assert_true "CO-D4 — progresso tem campo 'pct'"   "$PROG_BODY" "d['count'] == 0 or 'pct' in d['itens_com_prog'][0]['progresso']"
assert_true "CO-D5 — pct entre 0 e 100"           "$PROG_BODY" \
  "d['count'] == 0 or 0 <= d['itens_com_prog'][0]['progresso']['pct'] <= 100"

# Conquistas específicas com progresso esperado
DISC_PROG=$(echo "$GET7" | python3 -c "
import sys,json
d = json.load(sys.stdin)
disc = next((c for c in d['conquistas'] if c['codigo'] == 'disciplinado'), None)
print(json.dumps(disc or {}))
" 2>/dev/null)
assert_true "CO-D6 — 'disciplinado' tem progresso não-null" "$DISC_PROG" "d.get('progresso') is not None"
assert_true "CO-D7 — 'disciplinado' progresso total=10" "$DISC_PROG" "d.get('progresso', {}).get('total') == 10"

# ══════════════════════════════════════════════════════════════════════════════
# CO-E  GET /api/conquistas — user sem conquistas (user46 após limpeza)
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-E — GET /api/conquistas: usuário sem conquistas"

GET46=$(curl -s "$BASE/api/conquistas" -H "Authorization: Bearer $TOK46")

assert_true "CO-E1 — total_conquistadas=0 para user46" "$GET46" "d['total_conquistadas'] == 0"
assert_true "CO-E2 — total_disponivel=195 para user46"  "$GET46" "d['total_disponivel'] == 195"
assert_true "CO-E3 — total_pontos=0 para user46"        "$GET46" "d['total_pontos'] == 0"
assert_true "CO-E4 — conquistas retorna todos os 195"   "$GET46" "len(d['conquistas']) == 195"
assert_true "CO-E5 — nenhuma conquistada=true"          "$GET46" "all(not c['conquistada'] for c in d['conquistas'])"

# ══════════════════════════════════════════════════════════════════════════════
# CO-F  GET /api/conquistas/novas
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-F — GET /api/conquistas/novas"

NOVAS7=$(curl -s "$BASE/api/conquistas/novas" -H "Authorization: Bearer $TOK7")

assert_field "CO-F1 — campo 'novas'" "$NOVAS7" "novas"
assert_true  "CO-F2 — novas é array" "$NOVAS7" "isinstance(d['novas'], list)"

# Verifica campos de cada notificação (se houver)
NOVAS_COUNT=$(echo "$NOVAS7" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['novas']))" 2>/dev/null)
if [[ "${NOVAS_COUNT:-0}" -gt 0 ]]; then
  assert_true "CO-F3 — item novas tem 'titulo'"          "$NOVAS7" "'titulo' in d['novas'][0]"
  assert_true "CO-F4 — item novas tem 'conquista_codigo'" "$NOVAS7" "'conquista_codigo' in d['novas'][0]"
  assert_true "CO-F5 — item novas tem 'pontos'"           "$NOVAS7" "'pontos' in d['novas'][0]"
  assert_true "CO-F6 — item novas tem 'raridade'"         "$NOVAS7" "'raridade' in d['novas'][0]"
else
  skip "CO-F3 — sem novas para verificar campos (user7 já visualizou tudo)"
  skip "CO-F4 — (depende de F3)"
  skip "CO-F5 — (depende de F3)"
  skip "CO-F6 — (depende de F3)"
fi

# user46 após limpeza → novas = 0
NOVAS46=$(curl -s "$BASE/api/conquistas/novas" -H "Authorization: Bearer $TOK46")
assert_true "CO-F7 — user46 novas = 0 após reset" "$NOVAS46" "len(d['novas']) == 0"

# ══════════════════════════════════════════════════════════════════════════════
# CO-G  PATCH /api/conquistas/visualizar
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-G — PATCH /api/conquistas/visualizar"

# Primeiro: forçar conquista não-visualizada para user46
cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (46,'organizador',0)" 2>/dev/null >/dev/null

# Verificar que aparece em /novas
NOVAS_ANTES=$(curl -s "$BASE/api/conquistas/novas" -H "Authorization: Bearer $TOK46")
NOVAS_CNT_ANTES=$(echo "$NOVAS_ANTES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['novas']))" 2>/dev/null)

PATCH_RESP=$(curl -s -X PATCH "$BASE/api/conquistas/visualizar" -H "Authorization: Bearer $TOK46")
assert_true "CO-G1 — PATCH /visualizar retorna success=true" "$PATCH_RESP" "d.get('success') == True"

# Após marcar visualizadas → /novas deve retornar 0
NOVAS_DEPOIS=$(curl -s "$BASE/api/conquistas/novas" -H "Authorization: Bearer $TOK46")
NOVAS_CNT_DEPOIS=$(echo "$NOVAS_DEPOIS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['novas']))" 2>/dev/null)

if [[ "${NOVAS_CNT_DEPOIS:-0}" -eq 0 ]]; then
  ok "CO-G2 — após /visualizar, /novas retorna 0"
else
  fail "CO-G2 — /novas ainda retorna ${NOVAS_CNT_DEPOIS} após /visualizar"
fi

# nao_visualizadas no GET deve zerar após PATCH
GET46_AFTER=$(curl -s "$BASE/api/conquistas" -H "Authorization: Bearer $TOK46")
assert_true "CO-G3 — nao_visualizadas=0 após PATCH" "$GET46_AFTER" "d['nao_visualizadas'] == 0"

# ══════════════════════════════════════════════════════════════════════════════
# CO-H  POST /api/conquistas/verificar — regras básicas para user46
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-H — POST /api/conquistas/verificar: regras básicas"

# Limpa conquistas de user46 novamente
cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="DELETE FROM conquistas_usuario WHERE user_id=46" 2>/dev/null >/dev/null

# User46 tem 1 despesa e 1 receita — deve ganhar 'organizador' e 'primeira_receita'
VER46=$(curl -s -X POST "$BASE/api/conquistas/verificar" \
  -H "Authorization: Bearer $TOK46" -H "Content-Type: application/json" -d '{}')

assert_field "CO-H1 — campo 'novas_conquistas'"  "$VER46" "novas_conquistas"
assert_field "CO-H2 — campo 'total_novas'"       "$VER46" "total_novas"
assert_true  "CO-H3 — total_novas >= 1"          "$VER46" "d['total_novas'] >= 1"
assert_true  "CO-H4 — 'organizador' desbloqueado"     "$VER46" "'organizador' in d['novas_conquistas']"
assert_true  "CO-H5 — 'primeira_receita' desbloqueado" "$VER46" "'primeira_receita' in d['novas_conquistas']"

# Segunda chamada deve retornar 0 novas (idempotente)
VER46_B=$(curl -s -X POST "$BASE/api/conquistas/verificar" \
  -H "Authorization: Bearer $TOK46" -H "Content-Type: application/json" -d '{}')
assert_true "CO-H6 — segunda chamada → total_novas=0 (idempotente)" "$VER46_B" "d['total_novas'] == 0"

# ══════════════════════════════════════════════════════════════════════════════
# CO-I  POST /api/conquistas/verificar — regras de investimento para user7
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-I — POST /api/conquistas/verificar: regras de investimento (user7)"

# User7 tem 17 investimentos de múltiplos tipos — deve ter: investidor, 5_investimentos, investidor_diversificado, etc.
VER7=$(curl -s -X POST "$BASE/api/conquistas/verificar" \
  -H "Authorization: Bearer $TOK7" -H "Content-Type: application/json" -d '{}')

assert_field "CO-I1 — /verificar retorna novas_conquistas" "$VER7" "novas_conquistas"

# Como user7 já tem quase tudo conquistado, total_novas pode ser 0
# O importante é que a chamada não retorne erro
assert_true "CO-I2 — /verificar não retorna erro" "$VER7" "'error' not in d"

# Confirmar via GET que user7 tem conquistas de investimento
GET7B=$(curl -s "$BASE/api/conquistas" -H "Authorization: Bearer $TOK7")
assert_true "CO-I3 — user7 tem conquista 'investidor'" "$GET7B" \
  "any(c['codigo']=='investidor' and c['conquistada'] for c in d['conquistas'])"
assert_true "CO-I4 — user7 tem conquista '5_investimentos'" "$GET7B" \
  "any(c['codigo']=='5_investimentos' and c['conquistada'] for c in d['conquistas'])"

# ══════════════════════════════════════════════════════════════════════════════
# CO-J  POST /api/conquistas/verificar — regras de metas e orçamentos
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-J — POST /api/conquistas/verificar: metas, orçamentos, tags"

GET7C=$(curl -s "$BASE/api/conquistas" -H "Authorization: Bearer $TOK7")

# User7 tem metas (13) → deve ter 'sonhador', '5_metas_ativas'
assert_true "CO-J1 — user7 tem 'sonhador'" "$GET7C" \
  "any(c['codigo']=='sonhador' and c['conquistada'] for c in d['conquistas'])"
assert_true "CO-J2 — user7 tem '5_metas_ativas'" "$GET7C" \
  "any(c['codigo']=='5_metas_ativas' and c['conquistada'] for c in d['conquistas'])"

# User7 tem orçamentos (8) → 'primeiro_orcamento' e '3_orcamentos'
assert_true "CO-J3 — user7 tem 'primeiro_orcamento'" "$GET7C" \
  "any(c['codigo']=='primeiro_orcamento' and c['conquistada'] for c in d['conquistas'])"
assert_true "CO-J4 — user7 tem '3_orcamentos'" "$GET7C" \
  "any(c['codigo']=='3_orcamentos' and c['conquistada'] for c in d['conquistas'])"

# User7 tem 15 tags → 'primeira_tag'
assert_true "CO-J5 — user7 tem 'primeira_tag'" "$GET7C" \
  "any(c['codigo']=='primeira_tag' and c['conquistada'] for c in d['conquistas'])"

# User7 tem recorrências → 'primeira_recorrencia'
assert_true "CO-J6 — user7 tem 'primeira_recorrencia'" "$GET7C" \
  "any(c['codigo']=='primeira_recorrencia' and c['conquistada'] for c in d['conquistas'])"

# User7 tem 5 cartões → 'carteirinha', 'dois_cartoes', 'cinco_cartoes'
assert_true "CO-J7 — user7 tem 'carteirinha'" "$GET7C" \
  "any(c['codigo']=='carteirinha' and c['conquistada'] for c in d['conquistas'])"
assert_true "CO-J8 — user7 tem 'dois_cartoes'" "$GET7C" \
  "any(c['codigo']=='dois_cartoes' and c['conquistada'] for c in d['conquistas'])"
assert_true "CO-J9 — user7 tem 'cinco_cartoes'" "$GET7C" \
  "any(c['codigo']=='cinco_cartoes' and c['conquistada'] for c in d['conquistas'])"

# ══════════════════════════════════════════════════════════════════════════════
# CO-K  POST /api/conquistas/verificar — score e despesas pagas
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-K — POST /api/conquistas/verificar: despesas pagas e score"

# User7 tem 748 despesas → '10_despesas_pagas', '50_despesas_pagas'
assert_true "CO-K1 — user7 tem '10_despesas_pagas'" "$GET7C" \
  "any(c['codigo']=='10_despesas_pagas' and c['conquistada'] for c in d['conquistas'])"
assert_true "CO-K2 — user7 tem '50_despesas_pagas'" "$GET7C" \
  "any(c['codigo']=='50_despesas_pagas' and c['conquistada'] for c in d['conquistas'])"

# User7 tem 748 despesas + 210 receitas = 958 transações → '100_transacoes', '500_transacoes'
assert_true "CO-K3 — user7 tem '100_transacoes'" "$GET7C" \
  "any(c['codigo']=='100_transacoes' and c['conquistada'] for c in d['conquistas'])"
assert_true "CO-K4 — user7 tem '500_transacoes'" "$GET7C" \
  "any(c['codigo']=='500_transacoes' and c['conquistada'] for c in d['conquistas'])"

# ══════════════════════════════════════════════════════════════════════════════
# CO-L  POST /api/conquistas/verificar — lembretes
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-L — POST /api/conquistas/verificar: lembretes"

# User7 tem 31 lembretes → 'lembrete_mestre' (>=5), '10_lembretes' (>=10)
assert_true "CO-L1 — user7 tem 'lembrete_mestre'" "$GET7C" \
  "any(c['codigo']=='lembrete_mestre' and c['conquistada'] for c in d['conquistas'])"
assert_true "CO-L2 — user7 tem '10_lembretes'" "$GET7C" \
  "any(c['codigo']=='10_lembretes' and c['conquistada'] for c in d['conquistas'])"

# ══════════════════════════════════════════════════════════════════════════════
# CO-M  POST /api/conquistas/reprocessar
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-M — POST /api/conquistas/reprocessar"

# Limpa conquistas user46 para forçar reprocessamento
cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="DELETE FROM conquistas_usuario WHERE user_id=46" 2>/dev/null >/dev/null

REPR46=$(curl -s -X POST "$BASE/api/conquistas/reprocessar" \
  -H "Authorization: Bearer $TOK46" -H "Content-Type: application/json" -d '{}')

assert_true  "CO-M1 — reprocessar retorna success=true" "$REPR46" "d.get('success') == True"
assert_field "CO-M2 — campo 'novas_desbloqueadas'"      "$REPR46" "novas_desbloqueadas"
assert_field "CO-M3 — campo 'codigos_novos'"            "$REPR46" "codigos_novos"
assert_field "CO-M4 — campo 'total_conquistadas'"       "$REPR46" "total_conquistadas"
assert_field "CO-M5 — campo 'mensagem'"                 "$REPR46" "mensagem"
assert_true  "CO-M6 — novas_desbloqueadas >= 1"         "$REPR46" "d['novas_desbloqueadas'] >= 1"
assert_true  "CO-M7 — 'organizador' nos codigos_novos"  "$REPR46" "'organizador' in d['codigos_novos']"

# Reprocessar user7 (já tem tudo) → novas_desbloqueadas pode ser 0, mas não deve dar erro
REPR7=$(curl -s -X POST "$BASE/api/conquistas/reprocessar" \
  -H "Authorization: Bearer $TOK7" -H "Content-Type: application/json" -d '{}')
assert_true "CO-M8 — reprocessar user7 sem erro" "$REPR7" "d.get('success') == True and 'error' not in d"

# Segunda chamada idempotente → novas_desbloqueadas = 0
REPR46_B=$(curl -s -X POST "$BASE/api/conquistas/reprocessar" \
  -H "Authorization: Bearer $TOK46" -H "Content-Type: application/json" -d '{}')
assert_true "CO-M9 — reprocessar 2ª vez → novas_desbloqueadas=0" "$REPR46_B" "d['novas_desbloqueadas'] == 0"

# ══════════════════════════════════════════════════════════════════════════════
# CO-N  Isolamento — user46 não vê conquistas de user7
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-N — Isolamento entre usuários"

# Pegar total_conquistadas de cada um separadamente
TOTAL7=$(echo "$GET7" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total_conquistadas'])" 2>/dev/null)
GET46_ISO=$(curl -s "$BASE/api/conquistas" -H "Authorization: Bearer $TOK46")
TOTAL46=$(echo "$GET46_ISO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total_conquistadas'])" 2>/dev/null)

if [[ "${TOTAL7:-0}" -gt "${TOTAL46:-0}" ]]; then
  ok "CO-N1 — user7 (${TOTAL7}) tem mais conquistas que user46 (${TOTAL46}) — isolados"
else
  fail "CO-N1 — user7 (${TOTAL7}) deveria ter mais conquistas que user46 (${TOTAL46})"
fi

# user46 não deve ter conquistas de user7 (pontos devem ser diferentes)
PT7=$(echo "$GET7" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total_pontos'])" 2>/dev/null)
PT46=$(echo "$GET46_ISO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total_pontos'])" 2>/dev/null)
if [[ "${PT7:-0}" -gt "${PT46:-0}" ]]; then
  ok "CO-N2 — pontos user7 (${PT7}) > user46 (${PT46}) — dados isolados"
else
  fail "CO-N2 — pontos user7 (${PT7}) deveria ser > user46 (${PT46})"
fi

# ══════════════════════════════════════════════════════════════════════════════
# CO-O  Consistência Engine ↔ DB: códigos sem definição (BUGS REAIS)
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-O — Consistência Engine ↔ DB"

# Extrair códigos chamados na engine
ENGINE_CODES=$(grep -oP "ganhar\('\K[^']+" /home/user/webapp/src/routes/conquistas.ts | sort -u)

# Extrair códigos no DB
DB_CODES=$(cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="SELECT codigo FROM conquistas_definicoes" 2>/dev/null \
  | grep '"codigo"' | grep -oP '(?<="codigo": ")[^"]+' | sort -u)

# Códigos na engine mas sem definição no DB
ORPHANS_ENGINE=()
while IFS= read -r code; do
  if ! echo "$DB_CODES" | grep -qxF "$code"; then
    ORPHANS_ENGINE+=("$code")
  fi
done <<< "$ENGINE_CODES"

if [[ ${#ORPHANS_ENGINE[@]} -eq 0 ]]; then
  ok "CO-O1 — todos os códigos da engine têm definição no DB"
else
  fail "CO-O1 — engine chama código(s) sem definição no DB: ${ORPHANS_ENGINE[*]}"
  # Detalhar cada órfão
  for c in "${ORPHANS_ENGINE[@]}"; do
    echo "       ⚠  engine usa '$c' mas conquistas_definicoes não tem esse código"
    # Tentar encontrar o código correto
    SIMILAR=$(echo "$DB_CODES" | python3 -c "
import sys, difflib
codes = sys.stdin.read().split()
target = '$c'
close = difflib.get_close_matches(target, codes, n=2, cutoff=0.5)
print('→ próximos no DB: ' + ', '.join(close) if close else '→ sem similar encontrado')
" 2>/dev/null)
    echo "       $SIMILAR"
  done
fi

# Códigos no DB mas nunca verificados na engine
ORPHANS_DB=()
while IFS= read -r code; do
  [[ -z "$code" || "$code" == "codigo" ]] && continue
  if ! echo "$ENGINE_CODES" | grep -qxF "$code"; then
    ORPHANS_DB+=("$code")
  fi
done <<< "$DB_CODES"

if [[ ${#ORPHANS_DB[@]} -eq 0 ]]; then
  ok "CO-O2 — todos os códigos do DB são verificados pela engine"
else
  fail "CO-O2 — DB tem código(s) nunca verificados pela engine: ${ORPHANS_DB[*]}"
fi

# CO-O3: Total de definições no DB = 195
DB_COUNT=$(echo "$DB_CODES" | wc -l | tr -d ' ')
if [[ "$DB_COUNT" -eq 195 ]]; then
  ok "CO-O3 — DB tem 195 definições de conquistas"
else
  fail "CO-O3 — DB tem $DB_COUNT definições (esperado 195)"
fi

# CO-O4: Total de códigos únicos na engine
ENG_COUNT=$(echo "$ENGINE_CODES" | wc -l | tr -d ' ')
if [[ "$ENG_COUNT" -ge 150 ]]; then
  ok "CO-O4 — engine verifica $ENG_COUNT códigos únicos (>= 150)"
else
  fail "CO-O4 — engine verifica apenas $ENG_COUNT códigos únicos"
fi

# ══════════════════════════════════════════════════════════════════════════════
# CO-P  Raridades e pontos: integridade dos dados no DB
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-P — Integridade dos dados no DB"

# Checar via GET que raridades são válidas
RARID_VALIDAS=$(echo "$GET7" | python3 -c "
import sys, json
d = json.load(sys.stdin)
valid = {'comum', 'raro', 'epico', 'lendario'}
invalidos = [c for c in d['conquistas'] if c.get('raridade') not in valid]
print(json.dumps({'invalidos': invalidos, 'count': len(invalidos)}))
" 2>/dev/null)
assert_true "CO-P1 — todas as raridades são válidas (comum/raro/epico/lendario)" "$RARID_VALIDAS" "d['count'] == 0"

# Checar que pontos são todos > 0
PONTOS_ZERO=$(echo "$GET7" | python3 -c "
import sys, json
d = json.load(sys.stdin)
zeros = [c for c in d['conquistas'] if (c.get('pontos') or 0) <= 0]
print(json.dumps({'zeros': [z['codigo'] for z in zeros], 'count': len(zeros)}))
" 2>/dev/null)
assert_true "CO-P2 — todas as conquistas têm pontos > 0" "$PONTOS_ZERO" "d['count'] == 0"

# Lendários devem ter >= 100 pontos
LEND_BAIXO=$(echo "$GET7" | python3 -c "
import sys, json
d = json.load(sys.stdin)
invalidos = [c['codigo'] for c in d['conquistas'] if c.get('raridade')=='lendario' and (c.get('pontos') or 0) < 100]
print(json.dumps({'invalidos': invalidos, 'count': len(invalidos)}))
" 2>/dev/null)
assert_true "CO-P3 — lendários têm >= 100 pontos" "$LEND_BAIXO" "d['count'] == 0"

# ══════════════════════════════════════════════════════════════════════════════
# CO-Q  Conquistas específicas importantes — verificar que são desbloqueadas corretamente
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-Q — Conquistas específicas do user7"

# Verificar conquistas importantes por categoria via GET (user7 tem dados ricos)
CODIGOS_ESPERADOS=(
  "primeira_receita"
  "organizador"
  "investidor"
  "carteirinha"
  "sonhador"
  "primeira_tag"
  "lembrete_mestre"
  "10_despesas_pagas"
  "50_despesas_pagas"
  "100_transacoes"
  "500_transacoes"
  "5_receitas"
  "primeiro_orcamento"
  "3_orcamentos"
  "primeira_recorrencia"
  "dois_cartoes"
  "cinco_cartoes"
  "5_investimentos"
  "5_metas_ativas"
  "10_lembretes"
)

N=1
for COD in "${CODIGOS_ESPERADOS[@]}"; do
  CONQUISTADA=$(echo "$GET7C" | python3 -c "
import sys,json
d=json.load(sys.stdin)
c=next((x for x in d['conquistas'] if x['codigo']=='$COD'), None)
print('sim' if c and c['conquistada'] else 'nao')
" 2>/dev/null)
  if [[ "$CONQUISTADA" == "sim" ]]; then
    ok "CO-Q$N — '$COD' conquistada ✓"
  else
    fail "CO-Q$N — '$COD' deveria estar conquistada para user7"
  fi
  ((N++))
done

# ══════════════════════════════════════════════════════════════════════════════
# CO-R  Notificação: conquista nova aparece em /novas antes de /visualizar
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-R — Fluxo: nova conquista → /novas → /visualizar"

# Criar conquista não-visualizada para user45
cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (45,'sonhador',0)" 2>/dev/null >/dev/null

# Deve aparecer em /novas
NOVAS45=$(curl -s "$BASE/api/conquistas/novas" -H "Authorization: Bearer $TOK45")
CNT_N=$(echo "$NOVAS45" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['novas']))" 2>/dev/null)

if [[ "${CNT_N:-0}" -ge 1 ]]; then
  ok "CO-R1 — conquista não-visualizada aparece em /novas"
else
  fail "CO-R1 — conquista não-visualizada não aparece em /novas"
fi

# nao_visualizadas no GET deve ser >= 1
GET45_NV=$(curl -s "$BASE/api/conquistas" -H "Authorization: Bearer $TOK45")
assert_true "CO-R2 — nao_visualizadas >= 1 antes do PATCH" "$GET45_NV" "d['nao_visualizadas'] >= 1"

# Marcar como visualizadas
curl -s -X PATCH "$BASE/api/conquistas/visualizar" -H "Authorization: Bearer $TOK45" >/dev/null

# Deve desaparecer de /novas
NOVAS45_B=$(curl -s "$BASE/api/conquistas/novas" -H "Authorization: Bearer $TOK45")
CNT_NB=$(echo "$NOVAS45_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['novas']))" 2>/dev/null)
if [[ "${CNT_NB:-0}" -eq 0 ]]; then
  ok "CO-R3 — após /visualizar, desaparece de /novas"
else
  fail "CO-R3 — ainda há ${CNT_NB} em /novas após /visualizar"
fi

# Cleanup user 45 sonhador se não tinha antes
cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="DELETE FROM conquistas_usuario WHERE user_id=45 AND conquista_codigo='sonhador'" 2>/dev/null >/dev/null

# ══════════════════════════════════════════════════════════════════════════════
# CO-S  Bugs identificados: códigos sem definição na tabela
# ══════════════════════════════════════════════════════════════════════════════
hdr "CO-S — Bugs corrigidos: 'patrimonio_500k' e 'saldo_positivo_3m'"

# CO-S1: engine deve chamar 'patrimonio_500k' (bug anterior: 'barreira_500k')
ENGINE_BARR=$(grep -c "ganhar('barreira_500k')" /home/user/webapp/src/routes/conquistas.ts 2>/dev/null; true)
ENGINE_BARR=$(echo "$ENGINE_BARR" | tr -d '[:space:]')
ENGINE_PATR=$(grep -c "ganhar('patrimonio_500k')" /home/user/webapp/src/routes/conquistas.ts 2>/dev/null; true)
ENGINE_PATR=$(echo "$ENGINE_PATR" | tr -d '[:space:]')
ENGINE_BARR=${ENGINE_BARR:-0}
ENGINE_PATR=${ENGINE_PATR:-0}
if [[ "$ENGINE_BARR" -eq 0 && "$ENGINE_PATR" -ge 1 ]]; then
  ok "CO-S1 — bug corrigido: engine usa 'patrimonio_500k' (não mais 'barreira_500k')"
else
  fail "CO-S1 — engine ainda usa código errado 'barreira_500k' (encontrado: ${ENGINE_BARR}x, patrimonio_500k: ${ENGINE_PATR}x)"
fi

# CO-S2: engine deve chamar 'saldo_positivo_3m' (bug anterior: 'salvo_positivo_3m')
ENGINE_SALVO=$(grep -c "ganhar('salvo_positivo_3m')" /home/user/webapp/src/routes/conquistas.ts 2>/dev/null; true)
ENGINE_SALVO=$(echo "$ENGINE_SALVO" | tr -d '[:space:]')
ENGINE_SALDO=$(grep -c "ganhar('saldo_positivo_3m')" /home/user/webapp/src/routes/conquistas.ts 2>/dev/null; true)
ENGINE_SALDO=$(echo "$ENGINE_SALDO" | tr -d '[:space:]')
ENGINE_SALVO=${ENGINE_SALVO:-0}
ENGINE_SALDO=${ENGINE_SALDO:-0}
if [[ "$ENGINE_SALVO" -eq 0 && "$ENGINE_SALDO" -ge 1 ]]; then
  ok "CO-S2 — bug corrigido: engine usa 'saldo_positivo_3m' (não mais 'salvo_positivo_3m')"
else
  fail "CO-S2 — engine ainda usa código errado 'salvo_positivo_3m' (encontrado: ${ENGINE_SALVO}x, saldo_positivo_3m: ${ENGINE_SALDO}x)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# CLEANUP
# ══════════════════════════════════════════════════════════════════════════════
hdr "CLEANUP"
cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="DELETE FROM conquistas_usuario WHERE user_id=46" 2>/dev/null >/dev/null
echo "  ✔ conquistas de user46 limpas"

# ══════════════════════════════════════════════════════════════════════════════
# SUMÁRIO
# ══════════════════════════════════════════════════════════════════════════════
echo
echo "══════════════════════════════════════════════════════════════"
TOTAL=$(( PASS + FAIL + SKIP ))
echo "  Total: $TOTAL | ✅ $PASS | ❌ $FAIL | ⏭ $SKIP"
echo "══════════════════════════════════════════════════════════════"
if [[ ${#FAILED_TESTS[@]} -gt 0 ]]; then
  echo "  Testes com falha:"
  for t in "${FAILED_TESTS[@]}"; do echo "    • $t"; done
fi
[[ $FAIL -eq 0 ]] && echo "  🎉 Todos os testes aprovados!" || echo "  ⚠  $FAIL falha(s) — revisar"
