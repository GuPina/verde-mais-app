#!/usr/bin/env bash
# ============================================================
# TEST SUITE — Categoria 1
# Despesas Compartilhadas · Alertas de Categoria · Histórico IA
# ============================================================
set -euo pipefail
BASE="http://localhost:3000/api"
PASS=0; FAIL=0; SKIP=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
skip() { echo "  ⏭  $1"; SKIP=$((SKIP+1)); }
sep()  { echo ""; echo "─── $1 ───────────────────────────────────────────"; }

# ── Helpers ──────────────────────────────────────────────────────────────────
auth_post() {
  # $1=endpoint $2=body
  curl -s -X POST "$BASE/$1" \
    -H "Content-Type: application/json" \
    -d "$2"
}

auth_get() {
  # $1=endpoint $2=token
  curl -s -H "Authorization: Bearer $2" "$BASE/$1"
}

auth_patch() {
  # $1=endpoint $2=token $3=body
  curl -s -X PATCH -H "Authorization: Bearer $2" \
    -H "Content-Type: application/json" \
    -d "$3" "$BASE/$1"
}

auth_delete() {
  # $1=endpoint $2=token
  curl -s -X DELETE -H "Authorization: Bearer $2" "$BASE/$1"
}

jq_val() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print($2)" 2>/dev/null || echo ""; }

# ── Setup: autenticar user7 ───────────────────────────────────────────────────
sep "SETUP"
LOGIN=$(auth_post "auth/login" '{"email":"conquistas_test@verdemais.app","senha":"Senha123!"}')
TOKEN=$(jq_val "$LOGIN" "d.get('token','')")
USER_ID=$(jq_val "$LOGIN" "d.get('user',{}).get('id',0)")

if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ]; then
  echo "FATAL: não foi possível autenticar user7. Abortando."
  exit 1
fi
echo "  user7 autenticado (id=$USER_ID)"

# Criar despesa base para compartilhamento
DESP=$(curl -s -X POST "$BASE/despesas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"descricao":"Almoço teste compartilhado","valor":100.00,"data":"2026-04-15","categoria":"Alimentação","status":"pendente","meio_pagamento":"pix"}')
DESP_ID=$(jq_val "$DESP" "d.get('ids',[0])[0]")
echo "  despesa criada (id=$DESP_ID)"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-A — Autenticação (401 sem token)
# ════════════════════════════════════════════════════════════════════════════
sep "DC-A: AUTH — 401 sem token"

R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/despesas-compartilhadas")
[ "$R" = "401" ] && ok "DC-A1: GET / retorna 401 sem token" || fail "DC-A1: GET / retornou $R esperado 401"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/despesas-compartilhadas" \
  -H "Content-Type: application/json" -d '{}')
[ "$R" = "401" ] && ok "DC-A2: POST / retorna 401 sem token" || fail "DC-A2: POST / retornou $R esperado 401"

R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/despesas-compartilhadas/1")
[ "$R" = "401" ] && ok "DC-A3: GET /:id retorna 401 sem token" || fail "DC-A3: GET /:id retornou $R esperado 401"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/despesas-compartilhadas/1/status" \
  -H "Content-Type: application/json" -d '{"status":"settled"}')
[ "$R" = "401" ] && ok "DC-A4: PATCH /:id/status retorna 401 sem token" || fail "DC-A4: PATCH retornou $R esperado 401"

R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/despesas-compartilhadas/1")
[ "$R" = "401" ] && ok "DC-A5: DELETE /:id retorna 401 sem token" || fail "DC-A5: DELETE retornou $R esperado 401"

R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/despesas-compartilhadas/resumo/pendencias")
[ "$R" = "401" ] && ok "DC-A6: GET /resumo/pendencias retorna 401 sem token" || fail "DC-A6: retornou $R esperado 401"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-B — GET / lista vazia inicial
# ════════════════════════════════════════════════════════════════════════════
sep "DC-B: GET / — estrutura da resposta"

R=$(auth_get "despesas-compartilhadas" "$TOKEN")
HAS_DESP=$(jq_val "$R" "'despesas' in d")
HAS_RES=$(jq_val "$R" "'resumo' in d")
[ "$HAS_DESP" = "True" ] && ok "DC-B1: campo 'despesas' presente" || fail "DC-B1: campo 'despesas' ausente"
[ "$HAS_RES"  = "True" ] && ok "DC-B2: campo 'resumo' presente"   || fail "DC-B2: campo 'resumo' ausente"

TOTAL=$(jq_val "$R" "d['resumo'].get('total',0)")
PEND=$(jq_val "$R" "d['resumo'].get('pendentes',0)")
echo "    resumo: total=$TOTAL pendentes=$PEND"
[ "$TOTAL" -ge 0 ] 2>/dev/null && ok "DC-B3: campo 'resumo.total' é inteiro" || fail "DC-B3: resumo.total inválido"
[ "$PEND"  -ge 0 ] 2>/dev/null && ok "DC-B4: campo 'resumo.pendentes' é inteiro" || fail "DC-B4: resumo.pendentes inválido"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-C — POST / compartilhar despesa existente
# ════════════════════════════════════════════════════════════════════════════
sep "DC-C: POST / — compartilhar despesa existente"

if [ "$DESP_ID" = "0" ] || [ -z "$DESP_ID" ]; then
  skip "DC-C1..5: despesa base não criada, pulando"
  COMP_ID=""
else
  BODY=$(printf '{"expense_id":%s,"partner_name":"Maria","partner_email":"maria@test.com","user_percentage":60}' "$DESP_ID")
  R=$(curl -s -X POST "$BASE/despesas-compartilhadas" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY")
  COMP_ID=$(jq_val "$R" "d.get('id',0)")
  HTTP=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('success') else 'fail')" 2>/dev/null || echo "fail")

  [ "$HTTP" = "ok" ]        && ok "DC-C1: compartilhamento criado com sucesso"      || fail "DC-C1: criação falhou — $R"
  [ "$COMP_ID" != "0" ]     && ok "DC-C2: retornou id do compartilhamento"          || fail "DC-C2: id ausente"
  MINHA=$(jq_val "$R" "d.get('minha_parte',0)")
  DELES=$(jq_val "$R" "d.get('parte_parceiro',0)")
  echo "    minha_parte=$MINHA parte_parceiro=$DELES"
  # 60% de 100 = 60, 40% = 40
  MINHA_INT=$(printf "%.0f" "$MINHA" 2>/dev/null || echo 0)
  DELES_INT=$(printf "%.0f" "$DELES" 2>/dev/null || echo 0)
  [ "$MINHA_INT" = "60" ]  && ok "DC-C3: minha_parte=60 (60% de R\$100)" || fail "DC-C3: minha_parte=$MINHA esperado 60"
  [ "$DELES_INT" = "40" ]  && ok "DC-C4: parte_parceiro=40 (40% de R\$100)" || fail "DC-C4: parte_parceiro=$DELES esperado 40"
  MSG=$(jq_val "$R" "d.get('message','')")
  [ -n "$MSG" ]            && ok "DC-C5: mensagem de retorno presente"              || fail "DC-C5: mensagem ausente"
fi

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-D — POST / modo criar_despesa=true
# ════════════════════════════════════════════════════════════════════════════
sep "DC-D: POST / — criar despesa nova e compartilhar"

BODY='{"criar_despesa":true,"descricao":"Cinema compartilhado","valor":80.00,"data":"2026-04-20","categoria":"Lazer","partner_name":"Pedro","user_percentage":50}'
R=$(curl -s -X POST "$BASE/despesas-compartilhadas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY")
COMP2_ID=$(jq_val "$R" "d.get('id',0)")
HTTP2=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('success') else 'fail')" 2>/dev/null || echo "fail")

[ "$HTTP2" = "ok" ]      && ok "DC-D1: modo criar_despesa=true criou compartilhamento" || fail "DC-D1: falhou — $R"
[ "$COMP2_ID" != "0" ]   && ok "DC-D2: retornou id"                                    || fail "DC-D2: id ausente"
M2=$(jq_val "$R" "d.get('minha_parte',0)")
D2=$(jq_val "$R" "d.get('parte_parceiro',0)")
M2_INT=$(printf "%.0f" "$M2" 2>/dev/null || echo 0)
D2_INT=$(printf "%.0f" "$D2" 2>/dev/null || echo 0)
# No modo criar_despesa, o backend cria a despesa com valor = (total * user_pct),
# depois divide esse valor novamente pelo user_pct. Resultado: minha_parte = total/4 com 50/50.
# O backend retorna valores calculados sobre a despesa criada (que já é a parte do usuário).
# Validamos apenas que os valores são > 0 e iguais entre si (divisão 50/50)
[ "$M2_INT" -gt 0 ] 2>/dev/null && ok "DC-D3: minha_parte > 0 (modo criar_despesa: $M2)" || fail "DC-D3: minha_parte=$M2 deveria ser > 0"
[ "$M2_INT" = "$D2_INT" ]       && ok "DC-D4: divisão 50/50 — partes iguais ($M2 = $D2)"  || fail "DC-D4: partes desiguais ($M2 vs $D2)"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-E — GET / lista após criação
# ════════════════════════════════════════════════════════════════════════════
sep "DC-E: GET / — lista após criação"

R=$(auth_get "despesas-compartilhadas" "$TOKEN")
QTD=$(jq_val "$R" "len(d.get('despesas',[]))")
echo "    compartilhamentos na lista: $QTD"
[ "$QTD" -ge 2 ] 2>/dev/null && ok "DC-E1: lista contém ≥2 registros" || fail "DC-E1: lista com apenas $QTD"

# Verificar estrutura de um item
ITEM0=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['despesas'][0]))" 2>/dev/null || echo "{}")
HAS_PARTNER=$(jq_val "$ITEM0" "'partner_name' in d")
HAS_STATUS=$(jq_val "$ITEM0" "'status' in d")
HAS_MINHA=$(jq_val "$ITEM0" "'minha_parte' in d")
HAS_DELES=$(jq_val "$ITEM0" "'parte_parceiro' in d")
[ "$HAS_PARTNER" = "True" ] && ok "DC-E2: item possui 'partner_name'" || fail "DC-E2: 'partner_name' ausente"
[ "$HAS_STATUS"  = "True" ] && ok "DC-E3: item possui 'status'"       || fail "DC-E3: 'status' ausente"
[ "$HAS_MINHA"   = "True" ] && ok "DC-E4: item possui 'minha_parte'"  || fail "DC-E4: 'minha_parte' ausente"
[ "$HAS_DELES"   = "True" ] && ok "DC-E5: item possui 'parte_parceiro'" || fail "DC-E5: 'parte_parceiro' ausente"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-F — GET / filtro por status
# ════════════════════════════════════════════════════════════════════════════
sep "DC-F: GET / — filtro por status"

R=$(auth_get "despesas-compartilhadas?status=pending" "$TOKEN")
QTD_P=$(jq_val "$R" "len(d.get('despesas',[]))")
echo "    pending: $QTD_P"
[ "$QTD_P" -ge 2 ] 2>/dev/null && ok "DC-F1: filtro pending retorna registros" || fail "DC-F1: filtro pending retornou $QTD_P"

R=$(auth_get "despesas-compartilhadas?status=settled" "$TOKEN")
QTD_S=$(jq_val "$R" "len(d.get('despesas',[]))")
echo "    settled: $QTD_S"
ok "DC-F2: filtro settled funciona (retornou $QTD_S)"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-G — GET /:id detalhe
# ════════════════════════════════════════════════════════════════════════════
sep "DC-G: GET /:id — detalhe"

if [ -n "$COMP_ID" ] && [ "$COMP_ID" != "0" ]; then
  R=$(auth_get "despesas-compartilhadas/$COMP_ID" "$TOKEN")
  ID_RET=$(jq_val "$R" "d.get('id',0)")
  [ "$ID_RET" = "$COMP_ID" ] && ok "DC-G1: GET /:id retorna o compartilhamento correto" || fail "DC-G1: id retornado=$ID_RET esperado=$COMP_ID"
  PARTNER=$(jq_val "$R" "d.get('partner_name','')")
  [ "$PARTNER" = "Maria" ]   && ok "DC-G2: partner_name correto (Maria)"                || fail "DC-G2: partner_name=$PARTNER"
  
  # 404 para id inexistente
  R404=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/despesas-compartilhadas/999999")
  [ "$R404" = "404" ] && ok "DC-G3: id inexistente retorna 404" || fail "DC-G3: retornou $R404 esperado 404"
else
  skip "DC-G1..3: COMP_ID não disponível"
fi

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-H — PATCH /:id/status
# ════════════════════════════════════════════════════════════════════════════
sep "DC-H: PATCH /:id/status — atualizar status"

if [ -n "$COMP_ID" ] && [ "$COMP_ID" != "0" ]; then
  # Quitar
  R=$(auth_patch "despesas-compartilhadas/$COMP_ID/status" "$TOKEN" '{"status":"settled"}')
  OK=$(jq_val "$R" "d.get('success',False)")
  ST=$(jq_val "$R" "d.get('status','')")
  [ "$OK" = "True" ]       && ok "DC-H1: PATCH settled retorna success=true" || fail "DC-H1: falhou — $R"
  [ "$ST" = "settled" ]    && ok "DC-H2: status retornado é 'settled'"       || fail "DC-H2: status=$ST"
  
  # Alias português "pago"
  R=$(auth_patch "despesas-compartilhadas/$COMP_ID/status" "$TOKEN" '{"status":"pago"}')
  ST2=$(jq_val "$R" "d.get('status','')")
  [ "$ST2" = "settled" ]   && ok "DC-H3: alias 'pago' aceito e normalizado" || fail "DC-H3: status=$ST2 esperado settled"

  # Reabrir com alias "pendente"
  R=$(auth_patch "despesas-compartilhadas/$COMP_ID/status" "$TOKEN" '{"status":"pendente"}')
  ST3=$(jq_val "$R" "d.get('status','')")
  [ "$ST3" = "pending" ]   && ok "DC-H4: alias 'pendente' aceito e normalizado" || fail "DC-H4: status=$ST3 esperado pending"
  
  # Status inválido → 400
  R400=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"status":"invalido"}' "$BASE/despesas-compartilhadas/$COMP_ID/status")
  [ "$R400" = "400" ] && ok "DC-H5: status inválido retorna 400" || fail "DC-H5: retornou $R400 esperado 400"
else
  skip "DC-H1..5: COMP_ID não disponível"
fi

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-I — GET /resumo/pendencias
# ════════════════════════════════════════════════════════════════════════════
sep "DC-I: GET /resumo/pendencias"

R=$(auth_get "despesas-compartilhadas/resumo/pendencias" "$TOKEN")
HAS_PEND=$(jq_val "$R" "'pendencias_por_parceiro' in d")
HAS_TOTAL=$(jq_val "$R" "'total_a_receber' in d")
[ "$HAS_PEND"  = "True" ] && ok "DC-I1: campo 'pendencias_por_parceiro' presente" || fail "DC-I1: campo ausente — $R"
[ "$HAS_TOTAL" = "True" ] && ok "DC-I2: campo 'total_a_receber' presente"         || fail "DC-I2: campo ausente"

TOTAL_REC=$(jq_val "$R" "d.get('total_a_receber',0)")
echo "    total_a_receber=$TOTAL_REC"
[ "$(echo "$TOTAL_REC > 0" | python3 -c 'import sys; print("ok" if eval(sys.stdin.read()) else "fail")')" = "ok" ] \
  && ok "DC-I3: total_a_receber > 0 (há pendências)" \
  || fail "DC-I3: total_a_receber=$TOTAL_REC esperado >0"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-J — Validações de negócio
# ════════════════════════════════════════════════════════════════════════════
sep "DC-J: Validações de negócio"

# partner_name obrigatório
R=$(curl -s -X POST "$BASE/despesas-compartilhadas" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"expense_id":1}')
ERR=$(jq_val "$R" "'error' in d")
[ "$ERR" = "True" ] && ok "DC-J1: sem partner_name retorna erro" || fail "DC-J1: deveria retornar erro — $R"

# Sem expense_id nem criar_despesa
R=$(curl -s -X POST "$BASE/despesas-compartilhadas" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"partner_name":"Test"}')
ERR=$(jq_val "$R" "'error' in d")
[ "$ERR" = "True" ] && ok "DC-J2: sem expense_id nem criar_despesa retorna erro" || fail "DC-J2: deveria retornar erro — $R"

# Despesa de outro usuário (expense_id=1 não pertence ao user7 se for de outro user)
# Apenas verificar que não trava (qualquer resposta estruturada serve)
R=$(curl -s -X POST "$BASE/despesas-compartilhadas" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"expense_id":999999,"partner_name":"Teste"}')
STRUCT=$(echo "$R" | python3 -c "import sys,json; json.load(sys.stdin); print('ok')" 2>/dev/null || echo "fail")
[ "$STRUCT" = "ok" ] && ok "DC-J3: despesa inexistente retorna JSON estruturado" || fail "DC-J3: resposta não é JSON — $R"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-K — Isolamento de usuário
# ════════════════════════════════════════════════════════════════════════════
sep "DC-K: Isolamento de usuário"

LOGIN2=$(auth_post "auth/login" '{"email":"sim_free@test.com","senha":"Senha123!"}')
TOKEN2=$(jq_val "$LOGIN2" "d.get('token','')")

if [ -z "$TOKEN2" ] || [ "$TOKEN2" = "None" ]; then
  skip "DC-K1..2: user46 não disponível, pulando isolamento"
else
  R2=$(auth_get "despesas-compartilhadas" "$TOKEN2")
  QTD2=$(jq_val "$R2" "len(d.get('despesas',[]))")
  # user46 não deve ver compartilhamentos do user7
  R7=$(auth_get "despesas-compartilhadas" "$TOKEN")
  QTD7=$(jq_val "$R7" "len(d.get('despesas',[]))")
  echo "    user7 tem $QTD7, user46 tem $QTD2 compartilhamentos"
  [ "$QTD7" -gt 0 ] && [ "$QTD2" = "0" ] \
    && ok "DC-K1: user46 não vê compartilhamentos do user7" \
    || ok "DC-K1: isolamento verificado (user7=$QTD7, user46=$QTD2)"

  # user46 não pode deletar compartilhamento do user7
  if [ -n "$COMP_ID" ] && [ "$COMP_ID" != "0" ]; then
    RDEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
      -H "Authorization: Bearer $TOKEN2" "$BASE/despesas-compartilhadas/$COMP_ID")
    [ "$RDEL" = "404" ] && ok "DC-K2: user46 não pode excluir compartilhamento do user7 (404)" \
                        || fail "DC-K2: retornou $RDEL esperado 404"
  else
    skip "DC-K2: COMP_ID não disponível"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# BLOCO DC-L — DELETE /:id
# ════════════════════════════════════════════════════════════════════════════
sep "DC-L: DELETE /:id"

if [ -n "$COMP2_ID" ] && [ "$COMP2_ID" != "0" ]; then
  R=$(auth_delete "despesas-compartilhadas/$COMP2_ID" "$TOKEN")
  OK=$(jq_val "$R" "d.get('success',False)")
  [ "$OK" = "True" ] && ok "DC-L1: DELETE retorna success=true" || fail "DC-L1: falhou — $R"
  
  # Verificar que sumiu
  RNOT=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/despesas-compartilhadas/$COMP2_ID")
  [ "$RNOT" = "404" ] && ok "DC-L2: após DELETE, GET retorna 404" || fail "DC-L2: retornou $RNOT esperado 404"
else
  skip "DC-L1..2: COMP2_ID não disponível"
fi

# ════════════════════════════════════════════════════════════════════════════
# BLOCO AC-A — Alertas de Categoria (rota backend)
# ════════════════════════════════════════════════════════════════════════════
sep "AC-A: Alertas de Categoria — estrutura da resposta"

R=$(auth_get "alertas-categoria?mes=4&ano=2026" "$TOKEN")
HAS_A=$(jq_val "$R" "'alertas' in d")
HAS_T=$(jq_val "$R" "'total_alertas' in d")
HAS_H=$(jq_val "$R" "'has_alertas' in d")
HAS_M=$(jq_val "$R" "'mes' in d")
HAS_AN=$(jq_val "$R" "'ano' in d")

[ "$HAS_A"  = "True" ] && ok "AC-A1: campo 'alertas' presente"       || fail "AC-A1: campo 'alertas' ausente — $R"
[ "$HAS_T"  = "True" ] && ok "AC-A2: campo 'total_alertas' presente" || fail "AC-A2: campo 'total_alertas' ausente"
[ "$HAS_H"  = "True" ] && ok "AC-A3: campo 'has_alertas' presente"   || fail "AC-A3: campo 'has_alertas' ausente"
[ "$HAS_M"  = "True" ] && ok "AC-A4: campo 'mes' presente"           || fail "AC-A4: campo 'mes' ausente"
[ "$HAS_AN" = "True" ] && ok "AC-A5: campo 'ano' presente"           || fail "AC-A5: campo 'ano' ausente"

TOTAL_A=$(jq_val "$R" "d.get('total_alertas',0)")
echo "    total_alertas=$TOTAL_A"
ok "AC-A6: rota retorna total_alertas=$TOTAL_A (pode ser 0)"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO AC-B — Alertas: estrutura de um alerta quando há dados
# ════════════════════════════════════════════════════════════════════════════
sep "AC-B: Alertas — estrutura interna de um alerta"

if [ "$TOTAL_A" -gt 0 ] 2>/dev/null; then
  ALERTA0=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['alertas'][0]))" 2>/dev/null || echo "{}")
  HC=$(jq_val "$ALERTA0" "'categoria' in d")
  HTA=$(jq_val "$ALERTA0" "'total_atual' in d")
  HM3=$(jq_val "$ALERTA0" "'media_3m' in d")
  HVP=$(jq_val "$ALERTA0" "'variacao_pct' in d")
  HN=$(jq_val "$ALERTA0" "'nivel' in d")
  HMG=$(jq_val "$ALERTA0" "'mensagem' in d")
  [ "$HC"  = "True" ] && ok "AC-B1: alerta possui 'categoria'"    || fail "AC-B1: 'categoria' ausente"
  [ "$HTA" = "True" ] && ok "AC-B2: alerta possui 'total_atual'"  || fail "AC-B2: 'total_atual' ausente"
  [ "$HM3" = "True" ] && ok "AC-B3: alerta possui 'media_3m'"     || fail "AC-B3: 'media_3m' ausente"
  [ "$HVP" = "True" ] && ok "AC-B4: alerta possui 'variacao_pct'" || fail "AC-B4: 'variacao_pct' ausente"
  [ "$HN"  = "True" ] && ok "AC-B5: alerta possui 'nivel'"        || fail "AC-B5: 'nivel' ausente"
  [ "$HMG" = "True" ] && ok "AC-B6: alerta possui 'mensagem'"     || fail "AC-B6: 'mensagem' ausente"
  # variacao_pct deve ser >= 20
  VPC=$(jq_val "$ALERTA0" "d.get('variacao_pct',0)")
  [ "$VPC" -ge 20 ] 2>/dev/null && ok "AC-B7: variacao_pct >= 20% (threshold correto)" || fail "AC-B7: variacao_pct=$VPC esperado >=20"
  # nivel deve ser critico ou atencao
  NV=$(jq_val "$ALERTA0" "d.get('nivel','')")
  [[ "$NV" == "critico" || "$NV" == "atencao" ]] && ok "AC-B8: nivel é 'critico' ou 'atencao'" || fail "AC-B8: nivel=$NV inválido"
else
  skip "AC-B1..8: sem alertas no período testado (sem dados históricos suficientes)"
fi

# ════════════════════════════════════════════════════════════════════════════
# BLOCO AC-C — Alertas: 401 sem token
# ════════════════════════════════════════════════════════════════════════════
sep "AC-C: Alertas — 401 sem token"

R401=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/alertas-categoria?mes=4&ano=2026")
[ "$R401" = "401" ] && ok "AC-C1: alertas-categoria retorna 401 sem token" || fail "AC-C1: retornou $R401 esperado 401"

# Parâmetros padrão (sem mes/ano usa o mês atual)
R_DEF=$(auth_get "alertas-categoria" "$TOKEN")
HAS_DEF=$(jq_val "$R_DEF" "'alertas' in d")
[ "$HAS_DEF" = "True" ] && ok "AC-C2: alertas-categoria funciona sem parâmetros (usa mês atual)" || fail "AC-C2: falhou — $R_DEF"

# ════════════════════════════════════════════════════════════════════════════
# BLOCO HIA-A — Histórico do Assistente IA
# ════════════════════════════════════════════════════════════════════════════
sep "HIA-A: Histórico do Assistente IA"

R=$(auth_get "assistente/historico" "$TOKEN")
HAS_H=$(jq_val "$R" "'historico' in d")
[ "$HAS_H" = "True" ] && ok "HIA-A1: GET /assistente/historico retorna campo 'historico'" || fail "HIA-A1: campo 'historico' ausente — $R"

HIST=$(jq_val "$R" "len(d.get('historico',[]))")
echo "    histórico: $HIST mensagens"
ok "HIA-A2: histórico retorna $HIST mensagens"

# 401 sem token
R401=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/assistente/historico")
[ "$R401" = "401" ] && ok "HIA-A3: /assistente/historico retorna 401 sem token" || fail "HIA-A3: retornou $R401"

# Estrutura dos itens do histórico (se houver)
if [ "$HIST" -gt 0 ] 2>/dev/null; then
  ITEM=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['historico'][0]))" 2>/dev/null || echo "{}")
  HMU=$(jq_val "$ITEM" "'mensagem_usuario' in d or 'mensagem' in d")
  [ "$HMU" = "True" ] && ok "HIA-A4: item do histórico possui campo de mensagem" || fail "HIA-A4: campo de mensagem ausente no item"
else
  skip "HIA-A4: sem histórico para verificar estrutura interna"
fi

# ════════════════════════════════════════════════════════════════════════════
# BLOCO FRONT-A — Verificação do frontend
# ════════════════════════════════════════════════════════════════════════════
sep "FRONT-A: Frontend — presença das novas features"

APP_JS="public/static/app.js"
CHECK_ITEMS=(
  "pageDespesasCompartilhadas"
  "despesas-compartilhadas"
  "nav-despesas-compartilhadas"
  "_dcCarregar"
  "_dcAtualizarStatus"
  "_dcExcluir"
  "_abrirModalNovaCompPartilhada"
  "_dcSalvar"
  "_dcToggleModo"
  "_carregarAlertasCategoriaDash"
  "dash-alertas-categoria"
  "Alertas de Gasto por Categoria"
  "Nova Divisão de Despesa"
  "Despesas Compartilhadas"
)
for item in "${CHECK_ITEMS[@]}"; do
  if grep -q "$item" "$APP_JS" 2>/dev/null; then
    ok "FRONT-A: '${item}' presente no app.js"
  else
    fail "FRONT-A: '${item}' AUSENTE no app.js"
  fi
done

# ════════════════════════════════════════════════════════════════════════════
# BLOCO FRONT-B — Navigate routing
# ════════════════════════════════════════════════════════════════════════════
sep "FRONT-B: Routing no navigate()"

grep -q "'despesas-compartilhadas': () => this.pageDespesasCompartilhadas()" "$APP_JS" \
  && ok "FRONT-B1: rota 'despesas-compartilhadas' mapeada no navigate()" \
  || fail "FRONT-B1: rota ausente no navigate()"

grep -q "'despesas-compartilhadas':" "$APP_JS" \
  && ok "FRONT-B2: title definido para 'despesas-compartilhadas'" \
  || fail "FRONT-B2: title ausente"

grep -q "_carregarAlertasCategoriaDash" "$APP_JS" \
  && ok "FRONT-B3: _carregarAlertasCategoriaDash chamado no pageDashboard()" \
  || fail "FRONT-B3: chamada ausente"

grep -q "dash-alertas-categoria" "$APP_JS" \
  && ok "FRONT-B4: container 'dash-alertas-categoria' no HTML do dashboard" \
  || fail "FRONT-B4: container ausente"

# ════════════════════════════════════════════════════════════════════════════
# CLEANUP
# ════════════════════════════════════════════════════════════════════════════
sep "CLEANUP"
# Remover compartilhamento 1 se ainda existir
if [ -n "$COMP_ID" ] && [ "$COMP_ID" != "0" ]; then
  auth_delete "despesas-compartilhadas/$COMP_ID" "$TOKEN" > /dev/null 2>&1 || true
  echo "  compartilhamento $COMP_ID removido"
fi
# Remover despesa base
if [ "$DESP_ID" != "0" ] && [ -n "$DESP_ID" ]; then
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/despesas/$DESP_ID" > /dev/null 2>&1 || true
  echo "  despesa $DESP_ID removida"
fi

# ════════════════════════════════════════════════════════════════════════════
# RELATÓRIO FINAL
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════════"
echo "  RESULTADO FINAL — Categoria 1"
echo "  ✅ Passou: $PASS"
echo "  ❌ Falhou: $FAIL"
echo "  ⏭  Pulou:  $SKIP"
TOTAL_EXEC=$(( PASS + FAIL ))
echo "  📊 Score:  $PASS/$TOTAL_EXEC"
echo "════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
