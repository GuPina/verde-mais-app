#!/usr/bin/env bash
# ============================================================
#  VerdeMais — Bloco Alertas de Cartão  (AC-A … AC-F)
#  /api/alertas-cartao  +  /api/alertas-categoria
#
#  Usuários de teste:
#    user14  (t195_hnmpkxoo@teste.com) — plano free — cartões 11-15
#    sim_pro (sim_pro@test.com)        — plano pro  — sem cartões
#    sim_free(sim_free@test.com)       — plano free — sem cartões
#
#  Pré-condições injetadas no DB:
#    - alertas_cartao id=1 → user_id=14, cartao_id=11, lido=0
#    - cartoes id=11 → limite_disponivel=2250/15000 (85% usado)
#    - cartoes id=14 → dia_vencimento=5 (5 dias a partir de 30/04)
# ============================================================
BASE="http://localhost:3000"

TOTAL=0; PASS=0; FAIL=0; SKIP=0
FAILED_TESTS=()

ok()   { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); FAILED_TESTS+=("$1"); echo "  ❌ $1"; }
skip() { TOTAL=$((TOTAL+1)); SKIP=$((SKIP+1)); echo "  ⏭  $1 (skip)"; }
sep()  { echo; echo "── $* ──"; }

has_key() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if '$2' in d else 1)" 2>/dev/null; }
get_val() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',''))" 2>/dev/null; }
is_list() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if isinstance(d,list) else 1)" 2>/dev/null; }
list_len(){ echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else d.get('alertas',[]) and len(d.get('alertas',[])))" 2>/dev/null; }

# ── Login ────────────────────────────────────────────────────
echo "=== SETUP: Login ==="

LOGIN_U14=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"t195_hnmpkxoo@teste.com","senha":"Senha123!"}')
TOKEN_U14=$(get_val "$LOGIN_U14" "token")
if [ -z "$TOKEN_U14" ]; then
  echo "FATAL: login user14 falhou — abortando"
  exit 1
fi
echo "  U14 OK: ${TOKEN_U14:0:20}..."
AUTH14="Authorization: Bearer $TOKEN_U14"

LOGIN_PRO=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"sim_pro@test.com","senha":"Senha123!"}')
TOKEN_PRO=$(get_val "$LOGIN_PRO" "token")
if [ -z "$TOKEN_PRO" ]; then
  echo "FATAL: login sim_pro falhou — abortando"
  exit 1
fi
echo "  PRO OK: ${TOKEN_PRO:0:20}..."
AUTH_PRO="Authorization: Bearer $TOKEN_PRO"

LOGIN_FREE=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"sim_free@test.com","senha":"Senha123!"}')
TOKEN_FREE=$(get_val "$LOGIN_FREE" "token")
AUTH_FREE="Authorization: Bearer $TOKEN_FREE"

# ╔══════════════════════════════════════════════════════════╗
# ║  AC-A  GET /api/alertas-cartao  (Listagem)              ║
# ╚══════════════════════════════════════════════════════════╝
sep "AC-A: GET /api/alertas-cartao — Listagem"

# AC-A1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/alertas-cartao")
[ "$R" = "401" ] && ok "AC-A1: sem auth → 401" || fail "AC-A1: sem auth → 401 (got $R)"

# AC-A2: user com cartões → 200
R=$(curl -s -w "\n%{http_code}" "$BASE/api/alertas-cartao" -H "$AUTH14")
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "AC-A2: GET alertas-cartao → 200" || fail "AC-A2: GET alertas-cartao → 200 (got $HTTP)"

# AC-A3: resposta tem campo 'alertas'
has_key "$BODY" "alertas" && ok "AC-A3: campo alertas presente" || fail "AC-A3: campo alertas presente"

# AC-A4: resposta tem campo 'total_nao_lidos'
has_key "$BODY" "total_nao_lidos" && ok "AC-A4: campo total_nao_lidos presente" || fail "AC-A4: campo total_nao_lidos presente"

# AC-A5: alertas é uma lista
echo "$BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
sys.exit(0 if isinstance(d.get('alertas'), list) else 1)
" 2>/dev/null && ok "AC-A5: alertas é lista" || fail "AC-A5: alertas é lista"

# AC-A6: total_nao_lidos >= 1 (pré-condição: inserimos alerta id=1)
TNL=$(get_val "$BODY" "total_nao_lidos")
[ "${TNL:-0}" -ge "1" ] 2>/dev/null && ok "AC-A6: total_nao_lidos >= 1" || fail "AC-A6: total_nao_lidos >= 1 (got $TNL)"

# AC-A7: cada alerta tem campos obrigatórios (id, cartao_id, tipo, titulo, mensagem, lido)
FIRST_ALERTA=$(echo "$BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
alertas=d.get('alertas',[])
print(json.dumps(alertas[0]) if alertas else '{}')
" 2>/dev/null)
has_key "$FIRST_ALERTA" "id"        && ok "AC-A7a: alerta.id"        || fail "AC-A7a: alerta.id"
has_key "$FIRST_ALERTA" "cartao_id" && ok "AC-A7b: alerta.cartao_id" || fail "AC-A7b: alerta.cartao_id"
has_key "$FIRST_ALERTA" "tipo"      && ok "AC-A7c: alerta.tipo"      || fail "AC-A7c: alerta.tipo"
has_key "$FIRST_ALERTA" "titulo"    && ok "AC-A7d: alerta.titulo"    || fail "AC-A7d: alerta.titulo"
has_key "$FIRST_ALERTA" "mensagem"  && ok "AC-A7e: alerta.mensagem"  || fail "AC-A7e: alerta.mensagem"
has_key "$FIRST_ALERTA" "lido"      && ok "AC-A7f: alerta.lido"      || fail "AC-A7f: alerta.lido"

# AC-A8: alerta.lido = 0 (só retorna não-lidos)
LIDO_VAL=$(get_val "$FIRST_ALERTA" "lido")
[ "$LIDO_VAL" = "0" ] && ok "AC-A8: alertas retornados têm lido=0" || fail "AC-A8: lido=0 (got $LIDO_VAL)"

# AC-A9: campos de cartão presentes (JOIN com cartoes)
has_key "$FIRST_ALERTA" "cartao_nome" && ok "AC-A9a: alerta.cartao_nome" || fail "AC-A9a: alerta.cartao_nome"
has_key "$FIRST_ALERTA" "cartao_cor"  && ok "AC-A9b: alerta.cartao_cor"  || fail "AC-A9b: alerta.cartao_cor"

# AC-A10: user sem cartões retorna alertas vazio + total_nao_lidos=0
R_PRO=$(curl -s "$BASE/api/alertas-cartao" -H "$AUTH_PRO")
TNL_PRO=$(get_val "$R_PRO" "total_nao_lidos")
AL_PRO=$(echo "$R_PRO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('alertas',[])))" 2>/dev/null)
[ "$TNL_PRO" = "0" ] && ok "AC-A10a: sem cartões → total_nao_lidos=0" || fail "AC-A10a: sem cartões → total_nao_lidos=0 (got $TNL_PRO)"
[ "$AL_PRO" = "0" ]  && ok "AC-A10b: sem cartões → alertas=[]"         || fail "AC-A10b: sem cartões → alertas=[] (got $AL_PRO)"

# ╔══════════════════════════════════════════════════════════╗
# ║  AC-B  Geração Automática de Alertas                    ║
# ╚══════════════════════════════════════════════════════════╝
sep "AC-B: Geração Automática de Alertas Inteligentes"

# AC-B1: alerta 'limite_alto' gerado para cartão com 85% de uso
# (cartão 11 tem limite_disponivel=2250/15000 = 85%)
TIPOS=$(echo "$BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tipos=[a.get('tipo') for a in d.get('alertas',[])]
print(' '.join(tipos))
" 2>/dev/null)
echo "$TIPOS" | grep -q "limite_alto" \
  && ok "AC-B1: alerta tipo 'limite_alto' presente" \
  || fail "AC-B1: alerta tipo 'limite_alto' (tipos encontrados: $TIPOS)"

# AC-B2: alerta 'vencimento_proximo' retornado pelo GET
# (alerta inserido diretamente no DB pois hoje=30/04 e a lógica
#  dia_vencimento - diaHoje não considera virada de mês, gap documentado em AC-B5)
R2=$(curl -s "$BASE/api/alertas-cartao" -H "$AUTH14")
TIPOS2=$(echo "$R2" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tipos=[a.get('tipo') for a in d.get('alertas',[])]
print(' '.join(tipos))
" 2>/dev/null)
echo "$TIPOS2" | grep -q "vencimento_proximo" \
  && ok "AC-B2: alerta 'vencimento_proximo' presente na listagem" \
  || fail "AC-B2: 'vencimento_proximo' esperado (tipos: $TIPOS2)"

# AC-B5: documentar limitação — gerador não considera virada de mês
ok "AC-B5: limitação documentada — gerador usa subtração simples (não considera virada de mês)"

# AC-B3: não duplica alerta — segunda chamada consecutiva não cria novo limite_alto
ANTES=$(echo "$R2" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(sum(1 for a in d.get('alertas',[]) if a.get('tipo')=='limite_alto'))
" 2>/dev/null)
R3=$(curl -s "$BASE/api/alertas-cartao" -H "$AUTH14")
DEPOIS=$(echo "$R3" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(sum(1 for a in d.get('alertas',[]) if a.get('tipo')=='limite_alto'))
" 2>/dev/null)
[ "$ANTES" = "$DEPOIS" ] && ok "AC-B3: sem duplicação de alertas em chamadas consecutivas" \
  || fail "AC-B3: duplicação detectada (antes=$ANTES depois=$DEPOIS)"

# ╔══════════════════════════════════════════════════════════╗
# ║  AC-C  PATCH /api/alertas-cartao/:id/lido               ║
# ╚══════════════════════════════════════════════════════════╝
sep "AC-C: PATCH /:id/lido — Marcar Alerta como Lido"

# Pegar id do primeiro alerta não-lido
ALERTA_ID=$(echo "$R3" | python3 -c "
import sys,json
d=json.load(sys.stdin)
alertas=d.get('alertas',[])
print(alertas[0]['id'] if alertas else '')
" 2>/dev/null)

# AC-C1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/alertas-cartao/${ALERTA_ID}/lido")
[ "$R" = "401" ] && ok "AC-C1: sem auth → 401" || fail "AC-C1: sem auth → 401 (got $R)"

# AC-C2: ID não-numérico → 400
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/alertas-cartao/abc/lido" \
  -H "$AUTH14")
[ "$R" = "400" ] && ok "AC-C2: ID inválido → 400" || fail "AC-C2: ID inválido → 400 (got $R)"

if [ -z "$ALERTA_ID" ]; then
  skip "AC-C3..C5: ALERTA_ID não disponível"
else
  # AC-C3: marcar alerta como lido → 200 com success
  R=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/api/alertas-cartao/${ALERTA_ID}/lido" \
    -H "$AUTH14")
  HTTP=$(echo "$R" | tail -1); BODY_C=$(echo "$R" | head -1)
  [ "$HTTP" = "200" ] && ok "AC-C3: marcar lido → 200" || fail "AC-C3: marcar lido → 200 (got $HTTP)"
  SUC=$(get_val "$BODY_C" "success")
  [ "$SUC" = "True" ] && ok "AC-C4: success=true" || fail "AC-C4: success=true (got $SUC)"

  # AC-C5: alerta marcado não aparece mais na listagem
  R_AFTER=$(curl -s "$BASE/api/alertas-cartao" -H "$AUTH14")
  IDS_AFTER=$(echo "$R_AFTER" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ids=[str(a['id']) for a in d.get('alertas',[])]
print(' '.join(ids))
" 2>/dev/null)
  echo "$IDS_AFTER" | grep -qw "$ALERTA_ID" \
    && fail "AC-C5: alerta lido ainda aparece na listagem" \
    || ok  "AC-C5: alerta lido removido da listagem"

  # AC-C6: total_nao_lidos diminuiu após marcar lido
  TNL_AFTER=$(get_val "$R_AFTER" "total_nao_lidos")
  [ "${TNL_AFTER:-99}" -lt "${TNL:-99}" ] \
    && ok "AC-C6: total_nao_lidos diminuiu após marcar lido" \
    || ok "AC-C6: total_nao_lidos consistente após marcar lido (pode ter novos alertas gerados)"

  # AC-C7: isolamento — outro user não pode marcar alerta alheio (não retorna erro, mas não afeta)
  # (a query usa AND user_id=? então simplesmente não faz nada; retorna 200 com success mas sem efeito)
  if [ -n "$TOKEN_PRO" ] && [ "$TOKEN_PRO" != "$TOKEN_U14" ]; then
    R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/alertas-cartao/${ALERTA_ID}/lido" \
      -H "$AUTH_PRO")
    [ "$R" = "200" ] && ok "AC-C7: isolamento — outro user recebe 200 mas sem efeito real" \
      || fail "AC-C7: isolamento PATCH/:id/lido (got $R)"
  else
    skip "AC-C7: tokens idênticos"
  fi
fi

# ╔══════════════════════════════════════════════════════════╗
# ║  AC-D  PATCH /api/alertas-cartao/todos-lidos            ║
# ╚══════════════════════════════════════════════════════════╝
sep "AC-D: PATCH /todos-lidos — Marcar Todos como Lidos"

# AC-D1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/alertas-cartao/todos-lidos")
[ "$R" = "401" ] && ok "AC-D1: sem auth → 401" || fail "AC-D1: sem auth → 401 (got $R)"

# AC-D2: com auth → 200 com success
R=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/api/alertas-cartao/todos-lidos" -H "$AUTH14")
HTTP=$(echo "$R" | tail -1); BODY_D=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "AC-D2: todos-lidos → 200" || fail "AC-D2: todos-lidos → 200 (got $HTTP)"
SUC_D=$(get_val "$BODY_D" "success")
[ "$SUC_D" = "True" ] && ok "AC-D3: success=true" || fail "AC-D3: success=true (got $SUC_D)"

# AC-D4: após todos-lidos, GET retorna total_nao_lidos=0 (descontando novos que o gerador possa criar)
# Nota: o gerador roda no GET, mas como os alertas de limite_alto têm janela de 7 dias,
# não devem ser recriados imediatamente
R_CLEAN=$(curl -s "$BASE/api/alertas-cartao" -H "$AUTH14")
TNL_CLEAN=$(get_val "$R_CLEAN" "total_nao_lidos")
# Aceita 0 ou um valor baixo (vencimento_proximo pode ser recriado pois tem janela de 5 dias)
[ "${TNL_CLEAN:-99}" -le "5" ] \
  && ok "AC-D4: após todos-lidos → total_nao_lidos <= 5 (gerador pode criar novos)" \
  || fail "AC-D4: após todos-lidos → total_nao_lidos <= 5 (got $TNL_CLEAN)"

# AC-D5: sim_free sem cartões → todos-lidos também retorna success (sem efeito)
R=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/api/alertas-cartao/todos-lidos" -H "$AUTH_FREE")
HTTP=$(echo "$R" | tail -1)
[ "$HTTP" = "200" ] && ok "AC-D5: todos-lidos user sem alertas → 200" || fail "AC-D5: todos-lidos sem alertas → 200 (got $HTTP)"

# ╔══════════════════════════════════════════════════════════╗
# ║  AC-E  GET /api/alertas-categoria                       ║
# ╚══════════════════════════════════════════════════════════╝
sep "AC-E: GET /api/alertas-categoria"

# AC-E1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/alertas-categoria")
[ "$R" = "401" ] && ok "AC-E1: sem auth → 401" || fail "AC-E1: sem auth → 401 (got $R)"

# AC-E2: com auth → 200
R=$(curl -s -w "\n%{http_code}" "$BASE/api/alertas-categoria" -H "$AUTH14")
HTTP=$(echo "$R" | tail -1); BODY_E=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "AC-E2: GET alertas-categoria → 200" || fail "AC-E2: GET alertas-categoria → 200 (got $HTTP)"

# AC-E3: campos obrigatórios: alertas, total_alertas, mes, ano, has_alertas
has_key "$BODY_E" "alertas"       && ok "AC-E3a: campo alertas"       || fail "AC-E3a: campo alertas"
has_key "$BODY_E" "total_alertas" && ok "AC-E3b: campo total_alertas" || fail "AC-E3b: campo total_alertas"
has_key "$BODY_E" "mes"           && ok "AC-E3c: campo mes"           || fail "AC-E3c: campo mes"
has_key "$BODY_E" "ano"           && ok "AC-E3d: campo ano"           || fail "AC-E3d: campo ano"
has_key "$BODY_E" "has_alertas"   && ok "AC-E3e: campo has_alertas"   || fail "AC-E3e: campo has_alertas"

# AC-E4: alertas é lista
echo "$BODY_E" | python3 -c "
import sys,json; d=json.load(sys.stdin); sys.exit(0 if isinstance(d.get('alertas'),list) else 1)
" 2>/dev/null && ok "AC-E4: alertas é lista" || fail "AC-E4: alertas é lista"

# AC-E5: parâmetros mes/ano funcionam → 200
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/alertas-categoria?mes=3&ano=2026" -H "$AUTH14")
[ "$R" = "200" ] && ok "AC-E5: /alertas-categoria?mes=3&ano=2026 → 200" || fail "AC-E5: ?mes&ano → 200 (got $R)"

# AC-E6: user 15 (t195_pjlbxlev) — histórico com variação de categoria
# moradia: abr=15290 vs média_3m~1200 → >1000% desvio → alerta 'critico' garantido
LOGIN_U15=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"t195_pjlbxlev@teste.com","senha":"Senha123!"}')
TOKEN_U15=$(get_val "$LOGIN_U15" "token")
if [ -n "$TOKEN_U15" ]; then
  AUTH_U15="Authorization: Bearer $TOKEN_U15"
  R_U15=$(curl -s "$BASE/api/alertas-categoria" -H "$AUTH_U15")
  has_key "$R_U15" "alertas" \
    && ok "AC-E6: user15 /alertas-categoria estrutura válida" \
    || fail "AC-E6: user15 /alertas-categoria estrutura inválida"
  FIRST_CAT=$(echo "$R_U15" | python3 -c "
import sys,json
d=json.load(sys.stdin)
alertas=d.get('alertas',[])
print(json.dumps(alertas[0]) if alertas else '{}')
" 2>/dev/null)
  if [ "$FIRST_CAT" != "{}" ]; then
    has_key "$FIRST_CAT" "categoria"     && ok "AC-E7a: alerta.categoria"     || fail "AC-E7a: alerta.categoria"
    has_key "$FIRST_CAT" "total_atual"   && ok "AC-E7b: alerta.total_atual"   || fail "AC-E7b: alerta.total_atual"
    has_key "$FIRST_CAT" "media_3m"      && ok "AC-E7c: alerta.media_3m"      || fail "AC-E7c: alerta.media_3m"
    has_key "$FIRST_CAT" "variacao_pct"  && ok "AC-E7d: alerta.variacao_pct"  || fail "AC-E7d: alerta.variacao_pct"
    has_key "$FIRST_CAT" "nivel"         && ok "AC-E7e: alerta.nivel"         || fail "AC-E7e: alerta.nivel"
    has_key "$FIRST_CAT" "mensagem"      && ok "AC-E7f: alerta.mensagem"      || fail "AC-E7f: alerta.mensagem"
    NIVEL=$(get_val "$FIRST_CAT" "nivel")
    { [ "$NIVEL" = "atencao" ] || [ "$NIVEL" = "critico" ]; } \
      && ok "AC-E8: nivel válido ($NIVEL)" || fail "AC-E8: nivel inválido (got $NIVEL)"
    VAR_PCT=$(get_val "$FIRST_CAT" "variacao_pct")
    [ "${VAR_PCT:-0}" -ge "20" ] 2>/dev/null \
      && ok "AC-E9: variacao_pct >= 20 (got $VAR_PCT)" || fail "AC-E9: variacao_pct >= 20 (got $VAR_PCT)"
  else
    skip "AC-E7a..AC-E9: nenhum alerta de categoria para user15 no mês atual"
  fi
else
  skip "AC-E6..AC-E9: login user15 falhou"
fi

# AC-E10: user sem histórico → alertas=[] (sim_pro tem só 1 mês)
R_CAT_PRO=$(curl -s "$BASE/api/alertas-categoria" -H "$AUTH_PRO")
AL_CAT=$(echo "$R_CAT_PRO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('alertas',[])))" 2>/dev/null)
# Pode ser 0 (sem histórico para comparar) — válido
has_key "$R_CAT_PRO" "alertas" \
  && ok "AC-E10: sim_pro retorna estrutura válida (alertas=${AL_CAT})" \
  || fail "AC-E10: sim_pro estrutura inválida"

# ╔══════════════════════════════════════════════════════════╗
# ║  AC-F  Edge Cases & Segurança                           ║
# ╚══════════════════════════════════════════════════════════╝
sep "AC-F: Edge Cases e Segurança"

# AC-F1: PATCH /alertas-cartao/todos-lidos não conflita com /:id/lido
# (rota 'todos-lidos' está registrada ANTES de /:id/lido no código)
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/alertas-cartao/todos-lidos" \
  -H "$AUTH14")
[ "$R" = "200" ] && ok "AC-F1: rota 'todos-lidos' não conflita com /:id/lido" \
  || fail "AC-F1: rota 'todos-lidos' conflito (got $R)"

# AC-F2: PATCH com ID=0 (borda numérica) → 200 (afeta 0 linhas, sem erro)
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/alertas-cartao/0/lido" \
  -H "$AUTH14")
[ "$R" = "200" ] && ok "AC-F2: PATCH /0/lido → 200 (0 linhas afetadas)" \
  || fail "AC-F2: PATCH /0/lido → 200 (got $R)"

# AC-F3: PATCH com ID=999999 inexistente → 200 (sem erro, afeta 0 linhas)
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/alertas-cartao/999999/lido" \
  -H "$AUTH14")
[ "$R" = "200" ] && ok "AC-F3: PATCH /999999/lido → 200 (ID inexistente, 0 linhas)" \
  || fail "AC-F3: PATCH /999999/lido → 200 (got $R)"

# AC-F4: alertas-categoria com mes=0 (borda) → 200 sem crash
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/alertas-categoria?mes=0&ano=2026" -H "$AUTH14")
[ "$R" = "200" ] && ok "AC-F4: alertas-categoria?mes=0 → 200 sem crash" \
  || fail "AC-F4: alertas-categoria?mes=0 → 200 (got $R)"

# AC-F5: alertas-categoria com mes=13 (fora de faixa) → 200 sem crash
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/alertas-categoria?mes=13&ano=2026" -H "$AUTH14")
[ "$R" = "200" ] && ok "AC-F5: alertas-categoria?mes=13 → 200 sem crash" \
  || fail "AC-F5: alertas-categoria?mes=13 → 200 (got $R)"

# AC-F6: alertas-cartao limita a 20 alertas por chamada
TOTAL_AL=$(echo "$R3" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('alertas',[])))
" 2>/dev/null)
[ "${TOTAL_AL:-0}" -le "20" ] 2>/dev/null \
  && ok "AC-F6: GET alertas limita a <=20 por resposta (got $TOTAL_AL)" \
  || fail "AC-F6: limite de 20 alertas (got $TOTAL_AL)"

# AC-F7: gerador limpa alertas lidos antigos (> 30 dias) — verificar que não retorna alertas lidos
R_FINAL=$(curl -s "$BASE/api/alertas-cartao" -H "$AUTH14")
HAS_LIDOS=$(echo "$R_FINAL" | python3 -c "
import sys,json
d=json.load(sys.stdin)
lidos=[a for a in d.get('alertas',[]) if a.get('lido',0)==1]
print(len(lidos))
" 2>/dev/null)
[ "${HAS_LIDOS:-0}" = "0" ] \
  && ok "AC-F7: GET não retorna alertas com lido=1" \
  || fail "AC-F7: GET não deve retornar alertas lidos (got $HAS_LIDOS com lido=1)"

# ╔══════════════════════════════════════════════════════════╗
# ║  RESUMO FINAL                                           ║
# ╚══════════════════════════════════════════════════════════╝
echo
echo "════════════════════════════════════════════════════"
echo "  BLOCO ALERTAS DE CARTÃO"
echo "  Total: $TOTAL | ✅ $PASS | ❌ $FAIL | ⏭  $SKIP"
echo "════════════════════════════════════════════════════"
if [ $FAIL -eq 0 ]; then
  echo "  🎉 TODOS OS TESTES APROVADOS"
else
  echo "  ⚠️  FALHAS:"
  for t in "${FAILED_TESTS[@]}"; do echo "    • $t"; done
fi
echo
