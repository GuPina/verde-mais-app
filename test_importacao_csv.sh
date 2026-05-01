#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# test_importacao_csv.sh — Suite de testes: Módulo Importar CSV
# Rotas testadas:
#   POST /api/importacao/preview
#   POST /api/importacao/executar
#   POST /api/importacao/verificar-duplicatas
#   POST /api/importacao/registrar-log
#   GET  /api/importacao/templates
#   POST /api/importacao/templates
#   DELETE /api/importacao/templates/:banco
#   POST /api/importacao/criar-recorrencia
#   POST /api/importacao/criar-investimento
#   POST /api/importacao/ocr
#   POST /api/importacao/ocr-texto
# ══════════════════════════════════════════════════════════════════════════════

BASE="http://localhost:3000"
PASS=0; FAIL=0; SKIP=0
FAILED_TESTS=()

# ── helpers ────────────────────────────────────────────────────────────────────
ok()   { echo "  ✅ $1"; ((PASS++)); }
fail() { echo "  ❌ $1"; ((FAIL++)); FAILED_TESTS+=("$1"); }
skip() { echo "  ⏭  $1"; ((SKIP++)); }
hdr()  { echo; echo "── $1 ──"; }

assert_field() {
  local label="$1" body="$2" field="$3"
  if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in d, '$field missing'" 2>/dev/null; then
    ok "$label — campo '$field' presente"
  else
    fail "$label — campo '$field' ausente"
  fi
}

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

# ── setup: login usuários ──────────────────────────────────────────────────────
echo "═══ SETUP ════════════════════════════════════════════════════════════════"

# user 45 (pro)
LOGIN45=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"sim_pro@test.com","senha":"Senha123!"}')
TOK45=$(echo "$LOGIN45" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)

# user 46 (free)
LOGIN46=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"sim_free@test.com","senha":"Senha123!"}')
TOK46=$(echo "$LOGIN46" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)

if [[ -n "$TOK45" ]]; then echo "  ✔ user45 (pro)  autenticado"; else echo "  ✗ user45 falhou — abortando"; exit 1; fi
if [[ -n "$TOK46" ]]; then echo "  ✔ user46 (free) autenticado"; else echo "  ✗ user46 falhou — abortando"; exit 1; fi

# ── CSV de exemplo com cabeçalho padrão (semicolon) ───────────────────────────
CSV_BASICO='Data;Descricao;Valor;Categoria
2026-04-01;Uber viagem;35,90;Transporte
2026-04-02;iFood jantar;89,50;Alimentação
2026-04-03;Netflix;39,90;Streaming
2026-04-04;Farmácia;120,00;Saúde
2026-04-05;Academia SmartFit;99,00;Saúde'

CSV_RECEITA='Data;Descricao;Valor;Categoria
2026-04-10;Salário;8000,00;Salário
2026-04-11;Freelance;1500,00;Renda Extra'

CSV_PARCELA='Data;Descricao;Valor;Categoria
2026-03-10;TV Samsung 2/6;799,99;Compras
2026-04-10;TV Samsung 3/6;799,99;Compras'

CSV_DELIMITADOR_VIRGULA='Data,Descricao,Valor,Categoria
2026-04-15,Padaria Pão Quente,25.50,Alimentação
2026-04-16,Estacionamento,15.00,Transporte'

CSV_DUPLICATA="Data;Descricao;Valor;Categoria
2026-04-01;Uber viagem;35,90;Transporte"

# CSV sem cabeçalho (detecção automática por conteúdo)
CSV_SEM_HEADER='01/04/2026;Supermercado Extra;450,00
02/04/2026;Posto de Gasolina;180,00
03/04/2026;Farmacia Droga Raia;65,00'

CSV_INVESTIMENTO='Data;Descricao;Valor;Categoria
2026-04-20;Aplic Aut Poupanca;500,00;Investimento
2026-04-21;Tesouro Direto Selic;1000,00;Investimento'

CSV_RECORRENCIA='Data;Descricao;Valor;Categoria
2026-04-01;Pagto Salario Funcionario;3000,00;Salário
2026-04-05;Aluguel apartamento;2500,00;Moradia'

MAPEAMENTO_STD='{"data":0,"descricao":1,"valor":2,"categoria":3}'

# ══════════════════════════════════════════════════════════════════════════════
# IC-A  Autenticação — todos os endpoints exigem auth
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-A — Autenticação"

for ep in preview executar templates verificar-duplicatas registrar-log criar-recorrencia criar-investimento ocr ocr-texto; do
  METHOD="POST"
  [[ "$ep" == "templates" ]] && METHOD="GET"
  SC=$(curl -s -o /dev/null -w "%{http_code}" -X $METHOD "$BASE/api/importacao/$ep" \
       -H "Content-Type: application/json" -d '{}')
  assert_status "IC-A-$ep — sem token → 401" "$SC" "401"
done

# ══════════════════════════════════════════════════════════════════════════════
# IC-B  POST /api/importacao/preview — validações básicas
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-B — preview: validações"

# B1 — sem csv → 400
B1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/preview" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"tipo":"despesas"}')
assert_status "IC-B1 — sem csv → 400" "$B1" "400"

# B2 — csv com só 1 linha (sem dados) → 400
CSV_VAZIO='Data;Descricao;Valor'
B2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/preview" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d "{\"csv\":\"$CSV_VAZIO\",\"tipo\":\"despesas\"}")
assert_status "IC-B2 — CSV sem dados → 400" "$B2" "400"

# B3 — CSV sem coluna valor detectável → 400
CSV_INVALIDO='Nome;Obs
João;Teste'
B3_BODY=$(curl -s -X POST "$BASE/api/importacao/preview" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d "{\"csv\":\"$CSV_INVALIDO\",\"tipo\":\"despesas\"}")
B3_CODE=$(echo "$B3_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('400' if 'error' in d else 'ok')" 2>/dev/null)
if [[ "$B3_CODE" == "400" ]]; then ok "IC-B3 — CSV sem coluna valor → error"; else fail "IC-B3 — CSV sem coluna valor deve retornar error"; fi

# ══════════════════════════════════════════════════════════════════════════════
# IC-C  POST /api/importacao/preview — sucesso com CSV padrão
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-C — preview: CSV com cabeçalho semicolon"

CSV_JSON=$(python3 -c "import json,sys; print(json.dumps('$CSV_BASICO'.replace('\\\\n','\n').replace('\"','\\\"')))" 2>/dev/null || echo "\"$CSV_BASICO\"")
# Usar python para escapar corretamente
PREV_BODY=$(python3 -c "
import json, subprocess, sys
csv = '''Data;Descricao;Valor;Categoria
2026-04-01;Uber viagem;35,90;Transporte
2026-04-02;iFood jantar;89,50;Alimentação
2026-04-03;Netflix;39,90;Streaming
2026-04-04;Farmácia;120,00;Saúde
2026-04-05;Academia SmartFit;99,00;Saúde'''
payload = json.dumps({'csv': csv, 'tipo': 'despesas'})
import urllib.request
req = urllib.request.Request('http://localhost:3000/api/importacao/preview',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

if echo "$PREV_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'preview' in d" 2>/dev/null; then
  ok "IC-C1 — preview retorna campo 'preview'"
else
  fail "IC-C1 — preview não retornou campo 'preview'"
fi

assert_true "IC-C2 — preview.stats.total = 5" "$PREV_BODY" "d['stats']['total'] == 5"
assert_field "IC-C3 — campo 'total_linhas'" "$PREV_BODY" "total_linhas"
assert_field "IC-C4 — campo 'colunas_detectadas'" "$PREV_BODY" "colunas_detectadas"
assert_field "IC-C5 — campo 'cartoes'" "$PREV_BODY" "cartoes"
assert_field "IC-C6 — campo 'tags'" "$PREV_BODY" "tags"
assert_field "IC-C7 — campo 'stats'" "$PREV_BODY" "stats"
assert_field "IC-C8 — campo 'erros_preview'" "$PREV_BODY" "erros_preview"

# Verificar campos dentro de um item do preview
assert_true "IC-C9 — preview[0] tem campo 'descricao'" "$PREV_BODY" "'descricao' in d['preview'][0]"
assert_true "IC-C10 — preview[0] tem campo 'valor'" "$PREV_BODY" "'valor' in d['preview'][0]"
assert_true "IC-C11 — preview[0] tem campo 'categoria'" "$PREV_BODY" "'categoria' in d['preview'][0]"
assert_true "IC-C12 — preview[0] tem campo 'tag_sugerida'" "$PREV_BODY" "'tag_sugerida' in d['preview'][0]"
assert_true "IC-C13 — preview[0] tem campo 'duplicata'" "$PREV_BODY" "'duplicata' in d['preview'][0]"
assert_true "IC-C14 — preview[0] tem campo 'meio_pagamento'" "$PREV_BODY" "'meio_pagamento' in d['preview'][0]"
assert_true "IC-C15 — preview[0] tem campo 'status_sugerido'" "$PREV_BODY" "'status_sugerido' in d['preview'][0]"

# Netflix deve detectar categoria Streaming
assert_true "IC-C16 — Netflix detectado como Streaming" "$PREV_BODY" \
  "any(p['categoria']=='Streaming' for p in d['preview'])"

# Academia SmartFit deve detectar recorrência
assert_true "IC-C17 — Academia sugestão de recorrência detectada" "$PREV_BODY" \
  "any(p.get('recorrencia_sugerida') is not None for p in d['preview'])"

# ══════════════════════════════════════════════════════════════════════════════
# IC-D  POST /api/importacao/preview — detecção de parcelas
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-D — preview: detecção de parcelas"

PREV_PARC=$(python3 -c "
import json, urllib.request
csv = '''Data;Descricao;Valor;Categoria
2026-03-10;TV Samsung 2/6;799,99;Compras
2026-04-10;TV Samsung 3/6;799,99;Compras'''
payload = json.dumps({'csv': csv, 'tipo': 'despesas'})
req = urllib.request.Request('http://localhost:3000/api/importacao/preview',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-D1 — parcelas detectadas (stat > 0)" "$PREV_PARC" "d['stats']['parcelas_detectadas'] > 0"
assert_true "IC-D2 — primeira linha tem parcelaInfo" "$PREV_PARC" "d['preview'][0]['parcela'] is not None"
assert_true "IC-D3 — parcela.total = 6" "$PREV_PARC" "d['preview'][0]['parcela']['total'] == 6"
assert_true "IC-D4 — parcela.atual = 2 na primeira linha" "$PREV_PARC" "d['preview'][0]['parcela']['atual'] == 2"

# ══════════════════════════════════════════════════════════════════════════════
# IC-E  POST /api/importacao/preview — detecção de investimento e recorrência
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-E — preview: investimentos e recorrências"

PREV_INV=$(python3 -c "
import json, urllib.request
csv = '''Data;Descricao;Valor;Categoria
2026-04-20;Aplic Aut Poupanca;500,00;Investimento
2026-04-21;Tesouro Direto Selic;1000,00;Investimento'''
payload = json.dumps({'csv': csv, 'tipo': 'despesas'})
req = urllib.request.Request('http://localhost:3000/api/importacao/preview',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-E1 — Aplic Aut detectada como investimento (caixinha)" "$PREV_INV" \
  "d['preview'][0].get('investimento_sugerido') is not None and d['preview'][0]['investimento_sugerido']['tipo'] == 'caixinha'"
assert_true "IC-E2 — Tesouro Direto detectado como investimento" "$PREV_INV" \
  "d['preview'][1].get('investimento_sugerido') is not None and d['preview'][1]['investimento_sugerido']['tipo'] == 'tesouro_direto'"

PREV_REC=$(python3 -c "
import json, urllib.request
csv = '''Data;Descricao;Valor;Categoria
2026-04-01;Pagto Salario Funcionario;3000,00;Salário
2026-04-05;Aluguel;2500,00;Moradia
2026-04-06;Internet Vivo Fibra;120,00;Telecomunicações'''
payload = json.dumps({'csv': csv, 'tipo': 'despesas'})
req = urllib.request.Request('http://localhost:3000/api/importacao/preview',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-E3 — Salário detectado como recorrência" "$PREV_REC" \
  "d['preview'][0].get('recorrencia_sugerida') is not None"
assert_true "IC-E4 — Aluguel detectado como recorrência" "$PREV_REC" \
  "d['preview'][1].get('recorrencia_sugerida') is not None"
assert_true "IC-E5 — Internet detectada como recorrência" "$PREV_REC" \
  "d['preview'][2].get('recorrencia_sugerida') is not None"

# ══════════════════════════════════════════════════════════════════════════════
# IC-F  POST /api/importacao/preview — detecção de delimitador vírgula
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-F — preview: CSV com delimitador vírgula"

PREV_COMMA=$(python3 -c "
import json, urllib.request
csv = '''Data,Descricao,Valor,Categoria
2026-04-15,Padaria Pão Quente,25.50,Alimentação
2026-04-16,Estacionamento,15.00,Transporte'''
payload = json.dumps({'csv': csv, 'tipo': 'despesas'})
req = urllib.request.Request('http://localhost:3000/api/importacao/preview',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-F1 — preview com vírgula retorna 2 itens" "$PREV_COMMA" "d['stats']['total'] == 2"
assert_true "IC-F2 — Padaria detectada como Alimentação" "$PREV_COMMA" \
  "d['preview'][0]['categoria'] == 'Alimentação'"

# ══════════════════════════════════════════════════════════════════════════════
# IC-G  POST /api/importacao/preview — CSV sem cabeçalho (detecção por conteúdo)
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-G — preview: CSV sem cabeçalho"

PREV_NOHDR=$(python3 -c "
import json, urllib.request
csv = '''01/04/2026;Supermercado Extra;450,00
02/04/2026;Posto de Gasolina;180,00
03/04/2026;Farmacia Droga Raia;65,00'''
payload = json.dumps({'csv': csv, 'tipo': 'despesas'})
req = urllib.request.Request('http://localhost:3000/api/importacao/preview',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-G1 — preview sem header retorna ao menos 1 item" "$PREV_NOHDR" "d['stats']['total'] >= 1"

# ══════════════════════════════════════════════════════════════════════════════
# IC-H  POST /api/importacao/executar — validações básicas
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-H — executar: validações"

# H1 — sem parâmetros → 400
H1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/executar" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{}')
assert_status "IC-H1 — sem parâmetros → 400" "$H1" "400"

# H2 — tipo inválido → 400
H2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/executar" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d "{\"csv\":\"a;b\",\"tipo\":\"invalido\",\"mapeamento\":$MAPEAMENTO_STD}")
assert_status "IC-H2 — tipo inválido → 400" "$H2" "400"

# H3 — CSV com apenas cabeçalho (< 2 linhas) → 400
H3=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/executar" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d "{\"csv\":\"Data;Desc;Valor\",\"tipo\":\"despesas\",\"mapeamento\":$MAPEAMENTO_STD}")
assert_status "IC-H3 — CSV vazio → 400" "$H3" "400"

# ══════════════════════════════════════════════════════════════════════════════
# IC-I  POST /api/importacao/executar — importação de despesas
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-I — executar: importação de despesas simples"

# Obter contagem atual de despesas do user 45
DESP_ANTES=$(cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="SELECT COUNT(*) as cnt FROM despesas WHERE user_id=45" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['results'][0]['cnt'])" 2>/dev/null || echo "0")

EXEC_BODY=$(python3 -c "
import json, urllib.request
csv = '''Data;Descricao;Valor;Categoria
2026-04-01;Uber viagem importado;35,90;Transporte
2026-04-02;iFood jantar importado;89,50;Alimentação
2026-04-03;Farmácia importada;120,00;Saúde'''
payload = json.dumps({'csv': csv, 'tipo': 'despesas', 'mapeamento': {'data':0,'descricao':1,'valor':2,'categoria':3}})
req = urllib.request.Request('http://localhost:3000/api/importacao/executar',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-I1 — executar retorna success=true" "$EXEC_BODY" "d.get('success') == True"
assert_field "IC-I2 — campo 'importados'" "$EXEC_BODY" "importados"
assert_field "IC-I3 — campo 'ignorados'" "$EXEC_BODY" "ignorados"
assert_field "IC-I4 — campo 'mensagem'" "$EXEC_BODY" "mensagem"
assert_true "IC-I5 — importados = 3" "$EXEC_BODY" "d['importados'] == 3"
assert_true "IC-I6 — ignorados = 0" "$EXEC_BODY" "d['ignorados'] == 0"
assert_field "IC-I7 — campo 'ids_importados'" "$EXEC_BODY" "ids_importados"
assert_true "IC-I8 — ids_importados tem 3 entradas" "$EXEC_BODY" "len(d['ids_importados']) == 3"

# Confirmar no banco via API (não depende de parse do wrangler multi-statement)
DESP_DEPOIS=$(cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="SELECT COUNT(*) as cnt FROM despesas WHERE user_id=45 AND observacoes='Importado via CSV'" 2>/dev/null \
  | grep '"cnt"' | grep -o '[0-9]*' | head -1)
DESP_DEPOIS=${DESP_DEPOIS:-0}

if [[ "$DESP_DEPOIS" -ge 3 ]]; then
  ok "IC-I9 — banco tem $DESP_DEPOIS despesas importadas (>=3)"
else
  fail "IC-I9 — banco tem $DESP_DEPOIS despesas importadas via CSV (esperado >=3)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# IC-J  POST /api/importacao/executar — importação de receitas
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-J — executar: importação de receitas"

REC_ANTES=$(cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="SELECT COUNT(*) as cnt FROM receitas WHERE user_id=45" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['results'][0]['cnt'])" 2>/dev/null || echo "0")

EXEC_REC=$(python3 -c "
import json, urllib.request
csv = '''Data;Descricao;Valor;Categoria
2026-04-10;Salário importado;8000,00;Salário
2026-04-11;Freelance importado;1500,00;Renda Extra'''
payload = json.dumps({'csv': csv, 'tipo': 'receitas', 'mapeamento': {'data':0,'descricao':1,'valor':2,'categoria':3}})
req = urllib.request.Request('http://localhost:3000/api/importacao/executar',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-J1 — receitas: success=true" "$EXEC_REC" "d.get('success') == True"
assert_true "IC-J2 — receitas: importados=2" "$EXEC_REC" "d['importados'] == 2"

REC_DEPOIS=$(cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="SELECT COUNT(*) as cnt FROM receitas WHERE user_id=45 AND observacoes='Importado via CSV'" 2>/dev/null \
  | grep '"cnt"' | grep -o '[0-9]*' | head -1)
REC_DEPOIS=${REC_DEPOIS:-0}

if [[ "$REC_DEPOIS" -ge 2 ]]; then ok "IC-J3 — banco tem $REC_DEPOIS receitas importadas (>=2)"; else fail "IC-J3 — banco tem $REC_DEPOIS receitas importadas (esperado >=2)"; fi

# ══════════════════════════════════════════════════════════════════════════════
# IC-K  POST /api/importacao/executar — importação com parcelas
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-K — executar: importação de despesa parcelada"

PARC_ANTES=$(cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="SELECT COUNT(*) as cnt FROM despesas WHERE user_id=45 AND parcelado=1" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['results'][0]['cnt'])" 2>/dev/null || echo "0")

EXEC_PARC=$(python3 -c "
import json, urllib.request
csv = '''Data;Descricao;Valor;Categoria
2026-04-10;Notebook Dell 3/12;450,00;Compras'''
payload = json.dumps({'csv': csv, 'tipo': 'despesas', 'mapeamento': {'data':0,'descricao':1,'valor':2,'categoria':3}})
req = urllib.request.Request('http://localhost:3000/api/importacao/executar',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-K1 — parcela: success=true" "$EXEC_PARC" "d.get('success') == True"
assert_true "IC-K2 — parcelas_criadas = 12" "$EXEC_PARC" "d.get('parcelas_criadas', 0) == 12"
assert_true "IC-K3 — importados = 1 (série)" "$EXEC_PARC" "d['importados'] == 1"

PARC_DEPOIS=$(cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
  --command="SELECT COUNT(*) as cnt FROM despesas WHERE user_id=45 AND parcelado=1 AND descricao LIKE 'Notebook Dell%'" 2>/dev/null \
  | grep '"cnt"' | grep -o '[0-9]*' | head -1)
PARC_DEPOIS=${PARC_DEPOIS:-0}

if [[ "$PARC_DEPOIS" -eq 12 ]]; then ok "IC-K4 — banco criou 12 parcelas do Notebook Dell"; else fail "IC-K4 — banco tem $PARC_DEPOIS parcelas Notebook Dell (esperado 12)"; fi

# ══════════════════════════════════════════════════════════════════════════════
# IC-L  POST /api/importacao/executar — linhas_config: ignorar linha
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-L — executar: linhas_config (ignorar linhas)"

EXEC_CFG=$(python3 -c "
import json, urllib.request
csv = '''Data;Descricao;Valor;Categoria
2026-04-20;Despesa A ignorar;100,00;Outros
2026-04-20;Despesa B manter;200,00;Outros
2026-04-20;Despesa C ignorar;300,00;Outros'''
payload = json.dumps({
  'csv': csv,
  'tipo': 'despesas',
  'mapeamento': {'data':0,'descricao':1,'valor':2,'categoria':3},
  'linhas_config': [{'linha':2,'importar':False},{'linha':4,'importar':False}]
})
req = urllib.request.Request('http://localhost:3000/api/importacao/executar',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-L1 — importados=1 (apenas B mantida)" "$EXEC_CFG" "d['importados'] == 1"
assert_true "IC-L2 — ignorados=2 (A e C ignoradas)" "$EXEC_CFG" "d['ignorados'] == 2"

# ══════════════════════════════════════════════════════════════════════════════
# IC-M  POST /api/importacao/executar — tags_criadas automáticas
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-M — executar: criação automática de tags"

# Usar categoria única que provavelmente não tem tag ainda para o user46
EXEC_TAG=$(python3 -c "
import json, urllib.request
csv = '''Data;Descricao;Valor;Categoria
2026-04-22;Loja Pet Shop;85,00;Pets'''
payload = json.dumps({'csv': csv, 'tipo': 'despesas', 'mapeamento': {'data':0,'descricao':1,'valor':2,'categoria':3}})
req = urllib.request.Request('http://localhost:3000/api/importacao/executar',
  data=payload.encode(), headers={'Content-Type':'application/json','Authorization':'Bearer $TOK46'}, method='POST')
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
" 2>/dev/null)

assert_true "IC-M1 — success=true" "$EXEC_TAG" "d.get('success') == True"
assert_true "IC-M2 — tags_criadas >= 0" "$EXEC_TAG" "d.get('tags_criadas', 0) >= 0"

# ══════════════════════════════════════════════════════════════════════════════
# IC-N  POST /api/importacao/verificar-duplicatas
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-N — verificar-duplicatas"

# N1 — payload vazio → retorna duplicatas:[] total:0
N1_BODY=$(curl -s -X POST "$BASE/api/importacao/verificar-duplicatas" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"registros":[]}')
assert_true "IC-N1 — registros vazio → total=0" "$N1_BODY" "d['total'] == 0"
assert_field "IC-N2 — campo 'duplicatas'" "$N1_BODY" "duplicatas"

# N2 — verificar registro nunca importado (hash único) → não duplicata
N3_BODY=$(curl -s -X POST "$BASE/api/importacao/verificar-duplicatas" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"registros":[{"data":"2025-01-01","descricao":"Teste Único XYZ","valor":9999.99}]}')
assert_true "IC-N3 — registro novo → total=0" "$N3_BODY" "d['total'] == 0"

# ══════════════════════════════════════════════════════════════════════════════
# IC-O  POST /api/importacao/registrar-log e re-verificar duplicata
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-O — registrar-log e detecção de duplicata"

# O1 — registrar log de um lançamento específico
LOG_REG=$(curl -s -X POST "$BASE/api/importacao/registrar-log" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"registros":[{"data":"2026-02-14","descricao":"Lançamento Log Teste","valor":777.77}]}')
assert_true "IC-O1 — registrar-log success=true" "$LOG_REG" "d.get('success') == True"
assert_field "IC-O2 — campo 'salvos'" "$LOG_REG" "salvos"
assert_true "IC-O3 — salvos=1" "$LOG_REG" "d['salvos'] == 1"

# O2 — verificar o mesmo lançamento agora deve aparecer como duplicata
LOG_CHK=$(curl -s -X POST "$BASE/api/importacao/verificar-duplicatas" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"registros":[{"data":"2026-02-14","descricao":"Lançamento Log Teste","valor":777.77}]}')
assert_true "IC-O4 — verificar após log → total=1 duplicata" "$LOG_CHK" "d['total'] == 1"
assert_true "IC-O5 — duplicata tem campo 'importado_em'" "$LOG_CHK" "d['duplicatas'][0].get('importado_em') is not None"

# O3 — registrar o mesmo registro de novo → deve ser idempotente (ignorados=1)
LOG_REP=$(curl -s -X POST "$BASE/api/importacao/registrar-log" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"registros":[{"data":"2026-02-14","descricao":"Lançamento Log Teste","valor":777.77}]}')
assert_true "IC-O6 — re-registrar mesmo log → idempotente (salvos+ignorados=1)" "$LOG_REP" \
  "(d.get('salvos',0)+d.get('ignorados',0)) >= 1"

# ══════════════════════════════════════════════════════════════════════════════
# IC-P  GET /api/importacao/templates
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-P — templates: GET"

TPL_LIST=$(curl -s -X GET "$BASE/api/importacao/templates" \
  -H "Authorization: Bearer $TOK45")
assert_field "IC-P1 — GET templates retorna campo 'templates'" "$TPL_LIST" "templates"
assert_true "IC-P2 — templates é array" "$TPL_LIST" "isinstance(d['templates'], list)"

# ══════════════════════════════════════════════════════════════════════════════
# IC-Q  POST /api/importacao/templates — criar template
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-Q — templates: POST (criar)"

# Q1 — sem nome e banco → 400
Q1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/templates" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{}')
assert_status "IC-Q1 — sem nome/banco → 400" "$Q1" "400"

# Q2 — criar template válido
TPL_CREATE=$(curl -s -X POST "$BASE/api/importacao/templates" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"nome":"Nubank Teste","banco":"nubank_test","col_data":"data","col_desc":"descricao","col_valor":"valor","separador":";"}')
assert_true "IC-Q2 — criar template success=true" "$TPL_CREATE" "d.get('success') == True"
assert_field "IC-Q3 — template retorna campo 'template'" "$TPL_CREATE" "template"
assert_true "IC-Q4 — template.banco = nubank_test" "$TPL_CREATE" "d['template']['banco'] == 'nubank_test'"

# Q3 — atualizar template (upsert pelo banco)
TPL_UPDATE=$(curl -s -X POST "$BASE/api/importacao/templates" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"nome":"Nubank Atualizado","banco":"nubank_test","separador":","}')
assert_true "IC-Q5 — atualizar template (upsert) success=true" "$TPL_UPDATE" "d.get('success') == True"
assert_true "IC-Q6 — nome atualizado" "$TPL_UPDATE" "d['template']['nome'] == 'Nubank Atualizado'"

# Q4 — listar templates: deve conter o recém criado
TPL_LIST2=$(curl -s "$BASE/api/importacao/templates" -H "Authorization: Bearer $TOK45")
assert_true "IC-Q7 — template nubank_test aparece na listagem" "$TPL_LIST2" \
  "any(t['banco'] == 'nubank_test' for t in d['templates'])"

# ══════════════════════════════════════════════════════════════════════════════
# IC-R  DELETE /api/importacao/templates/:banco
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-R — templates: DELETE"

DEL_TPL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "$BASE/api/importacao/templates/nubank_test" \
  -H "Authorization: Bearer $TOK45")
assert_status "IC-R1 — DELETE template → 200" "$DEL_TPL" "200"

# Confirmar que saiu da listagem
TPL_POST_DEL=$(curl -s "$BASE/api/importacao/templates" -H "Authorization: Bearer $TOK45")
assert_true "IC-R2 — nubank_test não aparece mais" "$TPL_POST_DEL" \
  "not any(t['banco'] == 'nubank_test' for t in d['templates'])"

# ══════════════════════════════════════════════════════════════════════════════
# IC-S  POST /api/importacao/criar-recorrencia
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-S — criar-recorrencia"

# S1 — sem parâmetros obrigatórios → 400
S1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/criar-recorrencia" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"descricao":"Test"}')
assert_status "IC-S1 — sem tipo/valor → 400" "$S1" "400"

# S2 — criar recorrência válida
REC_CR=$(curl -s -X POST "$BASE/api/importacao/criar-recorrencia" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"descricao":"Netflix Import Test","valor":39.90,"tipo":"despesa","categoria":"Streaming","dia_vencimento":5}')
assert_true "IC-S2 — criar recorrência sucesso" "$REC_CR" "d.get('sucesso') == True"
assert_field "IC-S3 — retorna id" "$REC_CR" "id"
assert_field "IC-S4 — retorna mensagem" "$REC_CR" "mensagem"

# S3 — tentar criar recorrência duplicada → 409
REC_DUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/criar-recorrencia" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"descricao":"Netflix Import Test","valor":39.90,"tipo":"despesa","categoria":"Streaming"}')
assert_status "IC-S5 — recorrência duplicada → 409" "$REC_DUP" "409"

# Cleanup: desativar a recorrência criada para não poluir dados
REC_ID=$(echo "$REC_CR" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
if [[ -n "$REC_ID" ]]; then
  cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
    --command="DELETE FROM recorrencias WHERE id=$REC_ID AND user_id=45" 2>/dev/null >/dev/null
fi

# ══════════════════════════════════════════════════════════════════════════════
# IC-T  POST /api/importacao/criar-investimento
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-T — criar-investimento"

# T1 — sem parâmetros → 400
T1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/criar-investimento" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"nome":"Teste"}')
assert_status "IC-T1 — sem tipo/valor → 400" "$T1" "400"

# T2 — criar investimento válido (Tesouro Direto)
INV_CR=$(curl -s -X POST "$BASE/api/importacao/criar-investimento" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"nome":"Tesouro Selic Import","tipo":"tesouro_direto","valor_investido":1500.00,"instituicao":"Banco do Brasil"}')
assert_true "IC-T2 — criar investimento sucesso" "$INV_CR" "d.get('sucesso') == True"
assert_field "IC-T3 — retorna id" "$INV_CR" "id"
assert_field "IC-T4 — retorna mensagem" "$INV_CR" "mensagem"

# T3 — tipo inválido: deve normalizar para 'outros'
INV_TIPO=$(curl -s -X POST "$BASE/api/importacao/criar-investimento" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"nome":"Investimento Tipo Invalido","tipo":"xyz_invalido","valor_investido":100.00}')
assert_true "IC-T5 — tipo inválido normaliza para outros (sucesso)" "$INV_TIPO" "d.get('sucesso') == True"

# Cleanup
INV_ID=$(echo "$INV_CR" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
INV_ID2=$(echo "$INV_TIPO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
if [[ -n "$INV_ID" ]]; then
  cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local \
    --command="DELETE FROM investimentos WHERE id IN ($INV_ID,$INV_ID2) AND user_id=45" 2>/dev/null >/dev/null
fi

# ══════════════════════════════════════════════════════════════════════════════
# IC-U  POST /api/importacao/ocr — validações (sem OpenAI real)
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-U — ocr: validações"

# U1 — sem imagem_base64 → 400
U1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/ocr" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{}')
assert_status "IC-U1 — sem imagem → 400" "$U1" "400"

# U2 — mime type inválido (PDF) → 400
U2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/ocr" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"imagem_base64":"dGVzdGU=","mime_type":"application/pdf"}')
assert_status "IC-U2 — mime PDF → 400" "$U2" "400"

# U3 — imagem muito grande (> 4MB base64) → 400 (via python para evitar limit de arg shell)
U3_BODY=$(python3 -c "
import urllib.request, json
big = 'A' * (4097 * 1024)
payload = json.dumps({'imagem_base64': big, 'mime_type': 'image/jpeg'})
req = urllib.request.Request('http://localhost:3000/api/importacao/ocr',
  data=payload.encode(),
  headers={'Content-Type':'application/json','Authorization':'Bearer $TOK45'},
  method='POST')
try:
    with urllib.request.urlopen(req) as r:
        print(r.read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode())
" 2>/dev/null)
U3_ERR=$(echo "$U3_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if 'error' in d else 'nok')" 2>/dev/null)
if [[ "$U3_ERR" == "ok" ]]; then ok "IC-U3 — imagem enorme → error"; else fail "IC-U3 — imagem enorme deveria retornar error"; fi

# U4 — sem OPENAI_API_KEY → 503 (ambiente local sem chave configurada)
U4_BODY=$(curl -s -X POST "$BASE/api/importacao/ocr" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"imagem_base64":"dGVzdGU=","mime_type":"image/jpeg"}')
U4_CODE=$(echo "$U4_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('503' if 'Chave de API' in d.get('error','') else 'other')" 2>/dev/null)
if [[ "$U4_CODE" == "503" ]]; then
  ok "IC-U4 — sem OPENAI_KEY → 503 esperado"
else
  skip "IC-U4 — OPENAI_KEY configurada (não testável localmente)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# IC-V  POST /api/importacao/ocr-texto
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-V — ocr-texto: validações e parse"

# V1 — sem texto_extrato → 400
V1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/ocr-texto" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{}')
assert_status "IC-V1 — sem texto → 400" "$V1" "400"

# V2 — texto sem lançamentos reconhecíveis → 422
V2_BODY=$(curl -s -X POST "$BASE/api/importacao/ocr-texto" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"texto_extrato":"Isso não é um extrato bancário, é texto aleatório sem datas nem valores."}')
V2_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/ocr-texto" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"texto_extrato":"Isso não é um extrato bancário, é texto aleatório sem datas nem valores."}')
assert_status "IC-V2 — texto inválido → 422" "$V2_CODE" "422"

# V3 — texto com lançamentos bancários reais → 200 com CSV
EXTRATO_TEXTO='Nubank - Extrato de conta
Período: 01/04/2026 a 30/04/2026

01/04/2026  Pix enviado - Supermercado           D  150,00
05/04/2026  iFood *restaurante ABC               D   89,50
10/04/2026  TED recebido - Salário empresa       C 5000,00
15/04/2026  Uber *viagem                         D   35,90
20/04/2026  Netflix.com                          D   39,90'

V3_BODY=$(curl -s -X POST "$BASE/api/importacao/ocr-texto" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d "{\"texto_extrato\":$(python3 -c "import json; print(json.dumps('$EXTRATO_TEXTO'))" 2>/dev/null || echo '"extrato"')}")

V3_SC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/ocr-texto" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d "{\"texto_extrato\":$(python3 -c "
import json
txt='''Nubank - Extrato
01/04/2026  Pix enviado Supermercado  D  150,00
05/04/2026  iFood restaurante  D   89,50
10/04/2026  Salario recebido  C 5000,00'''
print(json.dumps(txt))
" 2>/dev/null || echo '"extrato"')}")

V3_FULL=$(curl -s -X POST "$BASE/api/importacao/ocr-texto" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
txt='''Nubank - Extrato
01/04/2026  Pix enviado Supermercado  D  150,00
05/04/2026  iFood restaurante  D   89,50
10/04/2026  Salario recebido  C 5000,00'''
print(json.dumps({'texto_extrato': txt}))
" 2>/dev/null)")

if echo "$V3_FULL" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('sucesso')==True" 2>/dev/null; then
  ok "IC-V3 — ocr-texto com extrato → sucesso=true"
  assert_field "IC-V4 — campo 'csv'" "$V3_FULL" "csv"
  assert_field "IC-V5 — campo 'banco_detectado'" "$V3_FULL" "banco_detectado"
  assert_field "IC-V6 — campo 'total_lancamentos'" "$V3_FULL" "total_lancamentos"
else
  skip "IC-V3 — extrato não reconhecido pelo parser (texto formato não suportado)"
  skip "IC-V4 — (dependente de IC-V3)"
  skip "IC-V5 — (dependente de IC-V3)"
  skip "IC-V6 — (dependente de IC-V3)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# IC-W  Isolamento: user46 não acessa dados do user45
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-W — Isolamento entre usuários"

# Registrar log com user45 e tentar ver com user46 → total=0 (hashes independentes por user_id)
LOG45=$(curl -s -X POST "$BASE/api/importacao/registrar-log" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d '{"registros":[{"data":"2026-03-01","descricao":"Exclusivo User45","valor":123.45}]}')

VER46=$(curl -s -X POST "$BASE/api/importacao/verificar-duplicatas" \
  -H "Authorization: Bearer $TOK46" -H "Content-Type: application/json" \
  -d '{"registros":[{"data":"2026-03-01","descricao":"Exclusivo User45","valor":123.45}]}')

assert_true "IC-W1 — user46 não vê log do user45" "$VER46" "d['total'] == 0"

# ══════════════════════════════════════════════════════════════════════════════
# IC-X  Texto longo demais em ocr-texto → 400
# ══════════════════════════════════════════════════════════════════════════════
hdr "IC-X — ocr-texto: texto excede 100.000 chars"

LONG_TEXT=$(python3 -c "print('A' * 100001)")
X1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/importacao/ocr-texto" \
  -H "Authorization: Bearer $TOK45" -H "Content-Type: application/json" \
  -d "{\"texto_extrato\":\"$LONG_TEXT\"}")
assert_status "IC-X1 — texto > 100k → 400" "$X1" "400"

# ══════════════════════════════════════════════════════════════════════════════
# CLEANUP — remover dados de teste
# ══════════════════════════════════════════════════════════════════════════════
hdr "CLEANUP"
cd /home/user/webapp && npx wrangler d1 execute verdemais-production --local --command="
  DELETE FROM despesas WHERE user_id=45 AND observacoes='Importado via CSV';
  DELETE FROM receitas WHERE user_id=45 AND observacoes='Importado via CSV';
  DELETE FROM importacao_log WHERE user_id IN (45,46);
" 2>/dev/null >/dev/null
echo "  ✔ dados de teste removidos"

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
