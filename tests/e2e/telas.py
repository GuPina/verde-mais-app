"""Varre todas as telas do VerdeMais no navegador, com sessão autenticada."""
import json, sys, re
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:3300'
cred = json.load(open('/tmp/claude-0/qa/credenciais.json'))

TELAS = [
    'dashboard', 'despesas', 'receitas', 'cartoes', 'metas', 'orcamentos',
    'recorrencias', 'lembretes', 'desafio', 'investimentos', 'analise-cartoes',
    'aportes', 'reserva', 'reservas-esp', 'financiamentos', 'emprestimos',
    'patrimonio', 'projecao', 'diagnostico', 'comparativo', 'relatorios',
    'simulacao', 'amortizacao', 'recebimentos', 'organizador', 'tags',
    'conquistas', 'importacao', 'perfil', 'regra',
]

falhas, erros_console, vazias = [], [], []

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    pg = b.new_page(viewport={'width': 1440, 'height': 900})

    # O container não alcança CDN. Sem isto, `axios` fica undefined, NENHUMA
    # chamada de API sai e toda tela mostra "Não foi possível carregar" — o que
    # pareceria 26 telas quebradas e seria falha do ambiente, não do app.
    LOCAIS = {
        'axios': '/tmp/verde-mais-app/node_modules/axios/dist/axios.min.js',
        'chart': '/tmp/verde-mais-app/node_modules/chart.js/dist/chart.umd.js',
    }
    def servir(route):
        u = route.request.url
        corpo = open(LOCAIS['axios']).read() if 'axios' in u else (
                open(LOCAIS['chart']).read() if 'chart' in u else '')
        # Tailwind e FontAwesome são só aparência: respondem vazio.
        route.fulfill(status=200, body=corpo,
            content_type='text/css' if u.endswith('.css') else 'application/javascript')
    pg.route(re.compile(r'^https://cdn'), servir)

    # Token obtido fora do navegador e injetado ANTES de qualquer navegação:
    # ir para /app sem token redireciona para o login e destrói o contexto.
    import urllib.request
    req = urllib.request.Request(BASE + '/api/auth/login',
        data=json.dumps({'email': cred['email'], 'senha': cred['senha']}).encode(),
        headers={'Content-Type': 'application/json'})
    sessao = json.loads(urllib.request.urlopen(req).read())
    # O app lê TRÊS chaves (app.js:94-99): sem vm_user e vm_login_at ele se
    # considera deslogado, renderiza o menu e falha em carregar cada tela.
    pg.add_init_script(
        "try {"
        f"localStorage.setItem('vm_token', {json.dumps(sessao['token'])});"
        f"localStorage.setItem('vm_user', {json.dumps(json.dumps(sessao.get('user') or {}))});"
        "localStorage.setItem('vm_login_at', String(Date.now()));"
        "} catch (e) {}")
    print('sessão injetada\n')

    for t in TELAS:
        msgs = []
        pg.on('console', lambda m, acc=msgs: acc.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e, acc=msgs: acc.append(f'[pageerror] {e}'))
        try:
            pg.goto(f'{BASE}/app/{t}', wait_until='networkidle', timeout=25000)
            pg.wait_for_timeout(1200)
            texto = pg.inner_text('body').strip()
            quebrado = pg.locator('.td-error, .error-state').count()
            pg.screenshot(path=f'/tmp/claude-0/qa/shots/{t}.png', full_page=True)
            reais = [m for m in msgs if 'favicon' not in m and 'net::ERR' not in m]
            marca = '  '
            if quebrado:
                falhas.append((t, 'estado de erro renderizado na tela')); marca = '🔴'
            elif len(texto) < 220:
                vazias.append((t, len(texto))); marca = '🟡'
            if reais:
                erros_console.append((t, reais[:3])); marca = '🔴' if marca == '  ' else marca
            print(f'{marca} {t:<18} {len(texto):>6} car  {len(reais)} erro(s) de console')
        except Exception as e:
            falhas.append((t, str(e)[:120])); print(f'🔴 {t:<18} NÃO CARREGOU: {str(e)[:80]}')
        pg.remove_listener('console', lambda m: None) if False else None
    b.close()

json.dump({'falhas': falhas, 'console': erros_console, 'vazias': vazias},
          open('/tmp/claude-0/qa/telas.json', 'w'), indent=1, ensure_ascii=False)
print(f'\n{len(falhas)} tela(s) quebrada(s) · {len(erros_console)} com erro de console · {len(vazias)} suspeitas de vazia')
