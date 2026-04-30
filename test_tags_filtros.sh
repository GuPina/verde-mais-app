#!/usr/bin/env bash
# ============================================================
#  VerdeMais — Bloco Tags & Filtros  (TF-A … TF-J)
#  Usuarios: sim_pro@test.com (id=45) | sim_free@test.com (id=46)
#  Despesa valida user45: 2731 (Roupas)  | Receita: 1321 | Investimento: 125
#  Despesa user14: 568  (para isolamento)
# ============================================================
BASE="http://localhost:3000"

# ── contadores ───────────────────────────────────────────────
TOTAL=0; PASS=0; FAIL=0; SKIP=0
FAILED_TESTS=()

ok()   { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); FAILED_TESTS+=("$1"); echo "  ❌ $1"; }
skip() { TOTAL=$((TOTAL+1)); SKIP=$((SKIP+1)); echo "  ⏭  $1 (skip)"; }
sep()  { echo; echo "── $* ──"; }

# ── helpers ──────────────────────────────────────────────────
http_code() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_status',200))" 2>/dev/null || echo "000"; }
has_key()   { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if '$2' in d else 1)" 2>/dev/null; }
get_val()   { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',''))" 2>/dev/null; }
is_list()   { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if isinstance(d,'$2'=='' and list or d,list) else 1)" 2>/dev/null; }
jq_val()    { echo "$2" | python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

# ── login ────────────────────────────────────────────────────
echo "=== SETUP: Login ==="

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
if [ -z "$TOKEN_FREE" ]; then
  echo "WARN: login sim_free falhou — usando token PRO para isolamento"
  TOKEN_FREE="$TOKEN_PRO"
fi
AUTH_FREE="Authorization: Bearer $TOKEN_FREE"

LOGIN_U14=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"t195_hnmpkxoo@teste.com","senha":"Senha123!"}')
TOKEN_U14=$(get_val "$LOGIN_U14" "token")
AUTH_U14="Authorization: Bearer $TOKEN_U14"

# IDs fixos já levantados no diagnóstico
DESP_ID=2731        # Roupas — user45
DESP_ID2=2729       # Assinaturas — user45 (segunda despesa)
RECEITA_ID=1321     # Salário — user45
INV_ID=125          # Tesouro Direto — user45
DESP_U14=568        # transporte — user14 (para isolamento)

# ── limpeza: remover tags velhas de testes anteriores ────────
curl -s "$BASE/api/tags" -H "$AUTH_PRO" | python3 -c "
import sys,json
tags=json.load(sys.stdin)
if isinstance(tags, list):
    for t in tags:
        if 'TF_' in t.get('nome','') or t.get('nome','').startswith('Tag'):
            print(t['id'])
" 2>/dev/null | while read TID; do
  curl -s -X DELETE "$BASE/api/tags/$TID" -H "$AUTH_PRO" > /dev/null
done

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-A  GET /api/tags  (Listagem)                        ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-A: Listagem de Tags"

# TF-A1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags")
[ "$R" = "401" ] && ok "TF-A1: sem auth → 401" || fail "TF-A1: sem auth → 401 (got $R)"

# TF-A2: com auth → 200 e array
R=$(curl -s "$BASE/api/tags" -H "$AUTH_PRO")
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if isinstance(d,list) else 1)" 2>/dev/null \
  && ok "TF-A2: GET /api/tags retorna array" || fail "TF-A2: GET /api/tags retorna array"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-B  POST /api/tags  (Criação de Tag)                 ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-B: Criação de Tag"

# TF-B1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -d '{"nome":"TF_Teste","cor":"#FF5500"}')
[ "$R" = "401" ] && ok "TF-B1: sem auth → 401" || fail "TF-B1: sem auth → 401 (got $R)"

# TF-B2: criar tag válida → 201
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"TF_Alpha","cor":"#10B981"}')
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
[ "$HTTP" = "201" ] && ok "TF-B2: criar tag → 201" || fail "TF-B2: criar tag → 201 (got $HTTP)"
TAG_ID=$(get_val "$BODY" "id")
TAG_NOME=$(get_val "$BODY" "nome")
[ -n "$TAG_ID" ] && ok "TF-B3: resposta tem id" || fail "TF-B3: resposta tem id"
[ "$TAG_NOME" = "TF_Alpha" ] && ok "TF-B4: resposta tem nome correto" || fail "TF-B4: nome correto (got $TAG_NOME)"

# TF-B5: duplicar mesmo nome → 409
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"TF_Alpha","cor":"#10B981"}')
[ "$R" = "409" ] && ok "TF-B5: duplicar nome → 409" || fail "TF-B5: duplicar nome → 409 (got $R)"

# TF-B6: nome vazio → 400
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"","cor":"#10B981"}')
[ "$R" = "400" ] && ok "TF-B6: nome vazio → 400" || fail "TF-B6: nome vazio → 400 (got $R)"

# TF-B7: cor inválida → 400
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"TF_Cor","cor":"vermelho"}')
[ "$R" = "400" ] && ok "TF-B7: cor inválida → 400" || fail "TF-B7: cor inválida → 400 (got $R)"

# TF-B8: nome > 30 chars → 400
LONG_NAME=$(python3 -c "print('X'*31)")
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"nome\":\"$LONG_NAME\",\"cor\":\"#10B981\"}")
[ "$R" = "400" ] && ok "TF-B8: nome > 30 chars → 400" || fail "TF-B8: nome > 30 chars → 400 (got $R)"

# TF-B9: criar segunda tag (para mesclar depois)
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"TF_Beta","cor":"#3B82F6"}')
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
TAG_ID2=$(get_val "$BODY" "id")
[ "$HTTP" = "201" ] && ok "TF-B9: criar segunda tag → 201" || fail "TF-B9: criar segunda tag → 201 (got $HTTP)"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-C  PATCH /api/tags/:id  (Edição de Tag)             ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-C: Edição de Tag (PATCH)"

# TF-C1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/tags/${TAG_ID}" \
  -H "Content-Type: application/json" -d '{"nome":"TF_Alpha2"}')
[ "$R" = "401" ] && ok "TF-C1: sem auth → 401" || fail "TF-C1: sem auth → 401 (got $R)"

# TF-C2: editar tag própria → 200
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/tags/${TAG_ID}" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"TF_Alpha_Edit","cor":"#8B5CF6"}')
[ "$R" = "200" ] && ok "TF-C2: editar tag → 200" || fail "TF-C2: editar tag → 200 (got $R)"

# TF-C3: editar tag inexistente → 404
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/tags/999999" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"Nova"}')
[ "$R" = "404" ] && ok "TF-C3: tag inexistente → 404" || fail "TF-C3: tag inexistente → 404 (got $R)"

# TF-C4: body vazio (nada a atualizar) → 400
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/tags/${TAG_ID}" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{}')
[ "$R" = "400" ] && ok "TF-C4: body vazio → 400" || fail "TF-C4: body vazio → 400 (got $R)"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-D  POST /api/tags/despesa/:id  (Vincular a despesa) ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-D: Vincular Tag a Despesa"

if [ -z "$TAG_ID" ] || [ -z "$DESP_ID" ]; then
  skip "TF-D1…D7: TAG_ID ou DESP_ID ausente"
else

# TF-D1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/despesa/${DESP_ID}" \
  -H "Content-Type: application/json" -d "{\"tag_ids\":[$TAG_ID]}")
[ "$R" = "401" ] && ok "TF-D1: vincular sem auth → 401" || fail "TF-D1: vincular sem auth → 401 (got $R)"

# TF-D2: vincular tag a despesa válida → 200
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags/despesa/${DESP_ID}" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"tag_ids\":[$TAG_ID]}")
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "TF-D2: vincular tag → 200" || fail "TF-D2: vincular tag → 200 (got $HTTP | $BODY)"
VINS=$(get_val "$BODY" "vinculadas")
[ "$VINS" = "1" ] && ok "TF-D3: vinculadas=1" || fail "TF-D3: vinculadas=1 (got $VINS)"

# TF-D4: GET /api/tags/despesa/:id retorna a tag vinculada
R=$(curl -s "$BASE/api/tags/despesa/${DESP_ID}" -H "$AUTH_PRO")
COUNT=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null)
[ "$COUNT" -ge "1" ] 2>/dev/null && ok "TF-D4: GET despesa/:id retorna >=1 tag" || fail "TF-D4: GET despesa/:id retorna tag (got $COUNT)"

# TF-D5: tag inválida (outro user) → 400
# Criar tag no user14 e tentar usar no user45
if [ -n "$TOKEN_U14" ] && [ "$TOKEN_U14" != "$TOKEN_PRO" ]; then
  R14=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags" \
    -H "Content-Type: application/json" -H "$AUTH_U14" \
    -d '{"nome":"TF_U14_Tag","cor":"#F59E0B"}')
  HTTP14=$(echo "$R14" | tail -1); BODY14=$(echo "$R14" | head -1)
  TAG_U14=$(get_val "$BODY14" "id")
  if [ -n "$TAG_U14" ] && [ "$HTTP14" = "201" ]; then
    R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/despesa/${DESP_ID}" \
      -H "Content-Type: application/json" -H "$AUTH_PRO" \
      -d "{\"tag_ids\":[$TAG_U14]}")
    [ "$R" = "400" ] && ok "TF-D5: tag de outro user → 400" || fail "TF-D5: tag de outro user → 400 (got $R)"
  else
    skip "TF-D5: sem token u14 válido"
  fi
else
  skip "TF-D5: tokens iguais, isolamento não testável aqui"
fi

# TF-D6: despesa inexistente → 404
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/despesa/999999" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"tag_ids\":[$TAG_ID]}")
[ "$R" = "404" ] && ok "TF-D6: despesa inexistente → 404" || fail "TF-D6: despesa inexistente → 404 (got $R)"

# TF-D7: despesa de outro usuário → 404
if [ -n "$TOKEN_U14" ] && [ "$TOKEN_U14" != "$TOKEN_PRO" ]; then
  R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/despesa/${DESP_U14}" \
    -H "Content-Type: application/json" -H "$AUTH_PRO" \
    -d "{\"tag_ids\":[$TAG_ID]}")
  [ "$R" = "404" ] && ok "TF-D7: despesa de outro user → 404" || fail "TF-D7: despesa de outro user → 404 (got $R)"
else
  skip "TF-D7: sem token u14 distinto"
fi

fi  # end if TAG_ID

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-E  POST /api/tags/receita/:id  (Vincular a receita) ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-E: Vincular Tag a Receita"

# TF-E1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/receita/${RECEITA_ID}" \
  -H "Content-Type: application/json" -d "{\"tag_ids\":[$TAG_ID]}")
[ "$R" = "401" ] && ok "TF-E1: sem auth → 401" || fail "TF-E1: sem auth → 401 (got $R)"

# TF-E2: vincular tag a receita válida → 200
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags/receita/${RECEITA_ID}" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"tag_ids\":[$TAG_ID]}")
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "TF-E2: vincular tag à receita → 200" || fail "TF-E2: vincular tag à receita → 200 (got $HTTP)"

# TF-E3: GET /api/tags/receita/:id retorna tag
R=$(curl -s "$BASE/api/tags/receita/${RECEITA_ID}" -H "$AUTH_PRO")
CNT=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null)
[ "${CNT:-0}" -ge "1" ] 2>/dev/null && ok "TF-E3: GET receita/:id retorna >=1 tag" || fail "TF-E3: GET receita/:id retorna tag (got $CNT)"

# TF-E4: receita inexistente → 404
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/receita/999999" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"tag_ids\":[$TAG_ID]}")
[ "$R" = "404" ] && ok "TF-E4: receita inexistente → 404" || fail "TF-E4: receita inexistente → 404 (got $R)"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-F  PUT/GET /api/tags/investimento/:id               ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-F: Vincular Tag a Investimento"

# TF-F1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/tags/investimento/${INV_ID}" \
  -H "Content-Type: application/json" -d "{\"tag_ids\":[$TAG_ID]}")
[ "$R" = "401" ] && ok "TF-F1: sem auth → 401" || fail "TF-F1: sem auth → 401 (got $R)"

# TF-F2: vincular → 200
R=$(curl -s -w "\n%{http_code}" -X PUT "$BASE/api/tags/investimento/${INV_ID}" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"tag_ids\":[$TAG_ID]}")
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "TF-F2: vincular tag a investimento → 200" || fail "TF-F2: vincular tag a investimento → 200 (got $HTTP)"

# TF-F3: GET /api/tags/investimento/:id retorna tag
R=$(curl -s "$BASE/api/tags/investimento/${INV_ID}" -H "$AUTH_PRO")
CNT=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null)
[ "${CNT:-0}" -ge "1" ] 2>/dev/null && ok "TF-F3: GET investimento/:id retorna >=1 tag" || fail "TF-F3: GET investimento/:id retorna tag (got $CNT)"

# TF-F4: investimento inexistente → 404
R=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/tags/investimento/999999" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"tag_ids\":[$TAG_ID]}")
[ "$R" = "404" ] && ok "TF-F4: investimento inexistente → 404" || fail "TF-F4: investimento inexistente → 404 (got $R)"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-G  GET /api/tags/buscar  (Busca por tag)            ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-G: Busca por Tag"

# TF-G1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags/buscar?tag_id=${TAG_ID}")
[ "$R" = "401" ] && ok "TF-G1: sem auth → 401" || fail "TF-G1: sem auth → 401 (got $R)"

# TF-G2: sem parâmetro → 400
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags/buscar" -H "$AUTH_PRO")
[ "$R" = "400" ] && ok "TF-G2: sem tag_id/q → 400" || fail "TF-G2: sem tag_id/q → 400 (got $R)"

# TF-G3: busca por tag_id → 200 com campos despesas/receitas/investimentos
R=$(curl -s "$BASE/api/tags/buscar?tag_id=${TAG_ID}" -H "$AUTH_PRO")
has_key "$R" "despesas"     && ok "TF-G3a: campo despesas presente"     || fail "TF-G3a: campo despesas"
has_key "$R" "receitas"     && ok "TF-G3b: campo receitas presente"     || fail "TF-G3b: campo receitas"
has_key "$R" "investimentos" && ok "TF-G3c: campo investimentos presente" || fail "TF-G3c: campo investimentos"

# TF-G4: busca por ?q=texto → 200
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags/buscar?q=TF_Alpha_Edit" -H "$AUTH_PRO")
[ "$R" = "200" ] && ok "TF-G4: busca por q= → 200" || fail "TF-G4: busca por q= → 200 (got $R)"

# TF-G5: despesa vinculada aparece nos resultados
R=$(curl -s "$BASE/api/tags/buscar?tag_id=${TAG_ID}" -H "$AUTH_PRO")
CNT_DESP=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('despesas',[])))" 2>/dev/null)
[ "${CNT_DESP:-0}" -ge "1" ] 2>/dev/null && ok "TF-G5: despesas >=1 no resultado" || fail "TF-G5: despesas >=1 (got $CNT_DESP)"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-H  GET /api/tags/autocomplete                       ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-H: Autocomplete"

# TF-H1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags/autocomplete?q=TF")
[ "$R" = "401" ] && ok "TF-H1: sem auth → 401" || fail "TF-H1: sem auth → 401 (got $R)"

# TF-H2: com auth → array
R=$(curl -s "$BASE/api/tags/autocomplete?q=TF" -H "$AUTH_PRO")
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if isinstance(d,list) else 1)" 2>/dev/null \
  && ok "TF-H2: autocomplete retorna array" || fail "TF-H2: autocomplete retorna array"

# TF-H3: resultado tem campos id, nome, cor, usos
FIRST=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d[0]) if d else '{}')" 2>/dev/null)
has_key "$FIRST" "id"   && ok "TF-H3a: campo id"   || fail "TF-H3a: campo id"
has_key "$FIRST" "nome" && ok "TF-H3b: campo nome" || fail "TF-H3b: campo nome"
has_key "$FIRST" "cor"  && ok "TF-H3c: campo cor"  || fail "TF-H3c: campo cor"
has_key "$FIRST" "usos" && ok "TF-H3d: campo usos" || fail "TF-H3d: campo usos"

# TF-H4: q vazio → retorna todas do usuário (até 10)
R=$(curl -s "$BASE/api/tags/autocomplete" -H "$AUTH_PRO")
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if isinstance(d,list) else 1)" 2>/dev/null \
  && ok "TF-H4: autocomplete sem q → array" || fail "TF-H4: autocomplete sem q → array"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-I  GET /api/tags/analise e /analise-anual           ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-I: Análise por Tag"

# TF-I1: /analise sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags/analise")
[ "$R" = "401" ] && ok "TF-I1: /analise sem auth → 401" || fail "TF-I1: /analise sem auth → 401 (got $R)"

# TF-I2: /analise com auth → 200 com campos obrigatórios
R=$(curl -s "$BASE/api/tags/analise" -H "$AUTH_PRO")
has_key "$R" "tags_analise"            && ok "TF-I2a: campo tags_analise"          || fail "TF-I2a: campo tags_analise"
has_key "$R" "tags_receita"            && ok "TF-I2b: campo tags_receita"          || fail "TF-I2b: campo tags_receita"
has_key "$R" "mes"                     && ok "TF-I2c: campo mes"                   || fail "TF-I2c: campo mes"
has_key "$R" "ano"                     && ok "TF-I2d: campo ano"                   || fail "TF-I2d: campo ano"
has_key "$R" "total_despesas_periodo"  && ok "TF-I2e: campo total_despesas_periodo" || fail "TF-I2e: campo total_despesas_periodo"

# TF-I3: /analise com parâmetros mes/ano → 200
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags/analise?mes=04&ano=2026" -H "$AUTH_PRO")
[ "$R" = "200" ] && ok "TF-I3: /analise?mes&ano → 200" || fail "TF-I3: /analise?mes&ano → 200 (got $R)"

# TF-I4: /analise-anual sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags/analise-anual")
[ "$R" = "401" ] && ok "TF-I4: /analise-anual sem auth → 401" || fail "TF-I4: /analise-anual sem auth → 401 (got $R)"

# TF-I5: /analise-anual com auth → array
R=$(curl -s "$BASE/api/tags/analise-anual" -H "$AUTH_PRO")
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if isinstance(d,list) else 1)" 2>/dev/null \
  && ok "TF-I5: /analise-anual retorna array" || fail "TF-I5: /analise-anual retorna array"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-J  GET /api/tags/despesas-sem-tag                   ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-J: Despesas sem Tag"

# TF-J1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags/despesas-sem-tag")
[ "$R" = "401" ] && ok "TF-J1: sem auth → 401" || fail "TF-J1: sem auth → 401 (got $R)"

# TF-J2: com auth → 200 com campos obrigatórios
R=$(curl -s "$BASE/api/tags/despesas-sem-tag" -H "$AUTH_PRO")
has_key "$R" "despesas"     && ok "TF-J2a: campo despesas"     || fail "TF-J2a: campo despesas"
has_key "$R" "tags_usuario" && ok "TF-J2b: campo tags_usuario" || fail "TF-J2b: campo tags_usuario"
has_key "$R" "total"        && ok "TF-J2c: campo total"        || fail "TF-J2c: campo total"
has_key "$R" "pagina"       && ok "TF-J2d: campo pagina"       || fail "TF-J2d: campo pagina"
has_key "$R" "total_paginas" && ok "TF-J2e: campo total_paginas" || fail "TF-J2e: campo total_paginas"

# TF-J3: paginação funciona (pagina=1 e pagina=2)
R1=$(curl -s "$BASE/api/tags/despesas-sem-tag?pagina=1&limit=5" -H "$AUTH_PRO")
P1=$(get_val "$R1" "pagina")
[ "$P1" = "1" ] && ok "TF-J3: pagina=1 ok" || fail "TF-J3: pagina=1 ok (got $P1)"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-K  POST /api/tags/aplicar-em-lote                   ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-K: Aplicar Tags em Lote"

# TF-K1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/aplicar-em-lote" \
  -H "Content-Type: application/json" \
  -d "{\"aplicacoes\":[{\"despesa_id\":$DESP_ID2,\"tag_id\":$TAG_ID}]}")
[ "$R" = "401" ] && ok "TF-K1: sem auth → 401" || fail "TF-K1: sem auth → 401 (got $R)"

# TF-K2: array vazio → 400
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/aplicar-em-lote" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"aplicacoes":[]}')
[ "$R" = "400" ] && ok "TF-K2: aplicacoes vazio → 400" || fail "TF-K2: aplicacoes vazio → 400 (got $R)"

# TF-K3: aplicar por tag_id → 200 com campos
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags/aplicar-em-lote" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"aplicacoes\":[{\"despesa_id\":$DESP_ID2,\"tag_id\":$TAG_ID}]}")
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "TF-K3: aplicar-em-lote → 200" || fail "TF-K3: aplicar-em-lote → 200 (got $HTTP)"
has_key "$BODY" "vinculadas" && ok "TF-K4: campo vinculadas presente" || fail "TF-K4: campo vinculadas"
has_key "$BODY" "criadas"    && ok "TF-K5: campo criadas presente"    || fail "TF-K5: campo criadas"
has_key "$BODY" "message"    && ok "TF-K6: campo message presente"    || fail "TF-K6: campo message"

# TF-K7: aplicar com tag_nome (cria nova tag automaticamente)
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags/aplicar-em-lote" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"aplicacoes\":[{\"despesa_id\":$DESP_ID2,\"tag_nome\":\"TF_AutoCriada\"}]}")
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "TF-K7: tag_nome cria nova tag → 200" || fail "TF-K7: tag_nome cria nova → 200 (got $HTTP)"
CRIADAS=$(get_val "$BODY" "criadas")
[ "${CRIADAS:-0}" -ge "1" ] 2>/dev/null && ok "TF-K8: criadas >= 1 (nova tag)" || fail "TF-K8: criadas >= 1 (got $CRIADAS)"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-L  POST /api/tags/sugerir-ia                        ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-L: Sugestão de Tag por IA"

# TF-L1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/sugerir-ia" \
  -H "Content-Type: application/json" \
  -d '{"descricao":"Netflix","categoria":"Lazer"}')
[ "$R" = "401" ] && ok "TF-L1: sem auth → 401" || fail "TF-L1: sem auth → 401 (got $R)"

# TF-L2: sem descricao e categoria → 400
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/sugerir-ia" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{}')
[ "$R" = "400" ] && ok "TF-L2: sem descricao/categoria → 400" || fail "TF-L2: sem descricao/categoria → 400 (got $R)"

# TF-L3: com dados válidos → 200 com campo tag_sugerida
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags/sugerir-ia" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"descricao":"Netflix","categoria":"Lazer","tipo":"despesa"}')
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "TF-L3: sugerir-ia → 200" || fail "TF-L3: sugerir-ia → 200 (got $HTTP)"
has_key "$BODY" "tag_sugerida" && ok "TF-L4: campo tag_sugerida presente" || fail "TF-L4: campo tag_sugerida"
has_key "$BODY" "metodo"       && ok "TF-L5: campo metodo presente"       || fail "TF-L5: campo metodo"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-M  POST /api/tags/mesclar                           ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-M: Mesclar Tags"

if [ -z "$TAG_ID" ] || [ -z "$TAG_ID2" ]; then
  skip "TF-M1…M6: TAG_ID ou TAG_ID2 ausente"
else

# TF-M1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/mesclar" \
  -H "Content-Type: application/json" \
  -d "{\"tag_origem_id\":$TAG_ID,\"tag_destino_id\":$TAG_ID2}")
[ "$R" = "401" ] && ok "TF-M1: sem auth → 401" || fail "TF-M1: sem auth → 401 (got $R)"

# TF-M2: body vazio → 400
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/mesclar" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{}')
[ "$R" = "400" ] && ok "TF-M2: body vazio → 400" || fail "TF-M2: body vazio → 400 (got $R)"

# TF-M3: mesma tag origem=destino → 400
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/mesclar" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"tag_origem_id\":$TAG_ID,\"tag_destino_id\":$TAG_ID}")
[ "$R" = "400" ] && ok "TF-M3: mesma tag origem=destino → 400" || fail "TF-M3: mesma tag → 400 (got $R)"

# TF-M4: tag_origem inexistente → 404
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tags/mesclar" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"tag_origem_id\":999999,\"tag_destino_id\":$TAG_ID2}")
[ "$R" = "404" ] && ok "TF-M4: origem inexistente → 404" || fail "TF-M4: origem inexistente → 404 (got $R)"

# TF-M5: mesclar válido → 200 com success/origem/destino/message
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags/mesclar" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d "{\"tag_origem_id\":$TAG_ID,\"tag_destino_id\":$TAG_ID2}")
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
[ "$HTTP" = "200" ] && ok "TF-M5: mesclar válido → 200" || fail "TF-M5: mesclar válido → 200 (got $HTTP)"
has_key "$BODY" "success" && ok "TF-M6a: campo success"  || fail "TF-M6a: campo success"
has_key "$BODY" "origem"  && ok "TF-M6b: campo origem"   || fail "TF-M6b: campo origem"
has_key "$BODY" "destino" && ok "TF-M6c: campo destino"  || fail "TF-M6c: campo destino"
has_key "$BODY" "message" && ok "TF-M6d: campo message"  || fail "TF-M6d: campo message"

# TF-M7: tag_origem foi deletada após mescla → 404
R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/tags/${TAG_ID}" -H "$AUTH_PRO")
# Se 404, a tag já foi deletada (sucesso da mescla); se 200 é bug
[ "$R" = "404" ] \
  && ok "TF-M7: tag_origem deletada após mescla" \
  || fail "TF-M7: tag_origem deveria ter sido deletada (got DELETE=$R)"

fi  # end if TAG_ID && TAG_ID2

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-N  GET /api/tags/sugestoes-mesclar                  ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-N: Sugestões de Mescla"

# Criar tags similares para testar sugestão
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"TF_Mercado","cor":"#06B6D4"}')
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
SIM_TAG1=$(get_val "$BODY" "id")

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"TF_Mercados","cor":"#06B6D4"}')
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
SIM_TAG2=$(get_val "$BODY" "id")

# TF-N1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tags/sugestoes-mesclar")
[ "$R" = "401" ] && ok "TF-N1: sem auth → 401" || fail "TF-N1: sem auth → 401 (got $R)"

# TF-N2: com auth → 200 com campos sugestoes e total
R=$(curl -s "$BASE/api/tags/sugestoes-mesclar" -H "$AUTH_PRO")
has_key "$R" "sugestoes" && ok "TF-N2: campo sugestoes" || fail "TF-N2: campo sugestoes"
has_key "$R" "total"     && ok "TF-N3: campo total"     || fail "TF-N3: campo total"

# TF-N4: tags similares (TF_Mercado / TF_Mercados) aparecem nas sugestões
TOTAL_SUGE=$(get_val "$R" "total")
[ "${TOTAL_SUGE:-0}" -ge "1" ] 2>/dev/null \
  && ok "TF-N4: >=1 sugestão de mescla para tags similares" \
  || fail "TF-N4: >=1 sugestão (got $TOTAL_SUGE)"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-O  DELETE /api/tags/:id                             ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-O: Excluir Tag"

# Criar tag para excluir
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/tags" \
  -H "Content-Type: application/json" -H "$AUTH_PRO" \
  -d '{"nome":"TF_ParaExcluir","cor":"#F43F5E"}')
HTTP=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -1)
DEL_TAG_ID=$(get_val "$BODY" "id")

# TF-O1: sem auth → 401
R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/tags/${DEL_TAG_ID}")
[ "$R" = "401" ] && ok "TF-O1: sem auth → 401" || fail "TF-O1: sem auth → 401 (got $R)"

# TF-O2: excluir tag própria → 200
R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/tags/${DEL_TAG_ID}" -H "$AUTH_PRO")
[ "$R" = "200" ] && ok "TF-O2: excluir tag → 200" || fail "TF-O2: excluir tag → 200 (got $R)"

# TF-O3: excluir tag inexistente → 404
R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/tags/999999" -H "$AUTH_PRO")
[ "$R" = "404" ] && ok "TF-O3: tag inexistente → 404" || fail "TF-O3: tag inexistente → 404 (got $R)"

# TF-O4: GET /api/tags lista o estado final coerente (array)
R=$(curl -s "$BASE/api/tags" -H "$AUTH_PRO")
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if isinstance(d,list) else 1)" 2>/dev/null \
  && ok "TF-O4: GET final retorna array" || fail "TF-O4: GET final retorna array"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-P  Integração: Tag aparece em GET /api/tags         ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-P: Integração — Tags nos campos de GET /api/tags"

R=$(curl -s "$BASE/api/tags" -H "$AUTH_PRO")
FIRST=$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if isinstance(d,list) and d:
    print(json.dumps(d[0]))
else:
    print('{}')
" 2>/dev/null)

has_key "$FIRST" "usos_despesas"      && ok "TF-P1: campo usos_despesas"      || fail "TF-P1: campo usos_despesas"
has_key "$FIRST" "usos_receitas"      && ok "TF-P2: campo usos_receitas"      || fail "TF-P2: campo usos_receitas"
has_key "$FIRST" "usos_investimentos" && ok "TF-P3: campo usos_investimentos" || fail "TF-P3: campo usos_investimentos"
has_key "$FIRST" "total_despesas"     && ok "TF-P4: campo total_despesas"     || fail "TF-P4: campo total_despesas"
has_key "$FIRST" "total_receitas"     && ok "TF-P5: campo total_receitas"     || fail "TF-P5: campo total_receitas"

# ╔══════════════════════════════════════════════════════════╗
# ║  TF-Q  Integração Assistente                            ║
# ╚══════════════════════════════════════════════════════════╝
sep "TF-Q: Integração Assistente (intent tags)"

ask_assistant() {
  curl -s -X POST "$BASE/api/assistente/chat" \
    -H "Content-Type: application/json" -H "$AUTH_PRO" \
    -d "{\"mensagem\":\"$1\"}"
}

# TF-Q1: mensagem sobre tags → resposta não vazia
R=$(ask_assistant "como uso as tags no app?")
RESP=$(get_val "$R" "resposta")
[ -n "$RESP" ] && ok "TF-Q1: assistente responde sobre tags" || fail "TF-Q1: assistente responde (got empty)"

# TF-Q2: intent é reconhecido (qualquer valor não vazio)
INT=$(get_val "$R" "intencao")
[ -n "$INT" ] && ok "TF-Q2: campo intencao presente (=$INT)" || fail "TF-Q2: campo intencao presente"

# ╔══════════════════════════════════════════════════════════╗
# ║  RESUMO FINAL                                           ║
# ╚══════════════════════════════════════════════════════════╝
echo
echo "════════════════════════════════════════════════════"
echo "  BLOCO TAGS & FILTROS"
echo "  Total: $TOTAL | ✅ $PASS | ❌ $FAIL | ⏭  $SKIP"
echo "════════════════════════════════════════════════════"
if [ $FAIL -eq 0 ]; then
  echo "  🎉 TODOS OS TESTES APROVADOS"
else
  echo "  ⚠️  FALHAS:"
  for t in "${FAILED_TESTS[@]}"; do echo "    • $t"; done
fi
echo
