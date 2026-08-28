# Design QA — Home e autenticação Terminal

## Artefatos

- Fonte visual: `C:\Users\gusta\OneDrive\Documentos\ChatGPT\Verde Mais\referencias-ux\terminal-v3\slides-landing.jsx` e `slides-app-1.jsx`.
- Tokens e marca: `design-tokens.jsx` e `logo.jsx` no mesmo diretório de referência.
- Implementação: `http://localhost:3100/`, `/login` e `/cadastro`.
- Evidências renderizadas:
  - `design-qa-evidence/home-desktop.png`
  - `design-qa-evidence/login-desktop.png`
  - `design-qa-evidence/cadastro-desktop.png`
- Viewport da implementação: 1920 × 855 CSS px, DPR 1; capturas com 1920 × 855 px.
- Estado: Home inicial, login vazio e cadastro vazio; também foram testados erro de login, senha visível, nome válido, e-mail inválido, força de senha e CTA desabilitado.

## Findings

- [P2 — corrigido] Coluna de texto do hero estreita demais.
  - Local: `.terminal-hero__copy`.
  - Evidência: a primeira renderização aplicava a margem do container completo dentro de meia tela, causando quebras excessivas no título e empilhando os CTAs.
  - Correção: padding substituído por `clamp(40px, 5vw, 80px)`, restabelecendo a proporção 50/50 e CTAs lado a lado.
  - Pós-correção: `design-qa-evidence/home-desktop.png`.

- [P2 — corrigido] Contraste herdado nos botões dentro de blocos claros.
  - Local: `.terminal-home .terminal-btn` e variantes.
  - Evidência: a regra genérica de links podia prevalecer sobre a cor das variantes primária e accent.
  - Correção: cores de texto das variantes foram explicitadas com seletor escopado.
  - Pós-correção: `design-qa-evidence/home-desktop.png`.

- [Bloqueador do QA formal] Não existe captura visual exportada do material-fonte.
  - O material recebido contém JSX/HTML de referência, mas não PNG, screenshot ou Figma capturável.
  - O Chrome selecionado pelo usuário não permite abrir o arquivo local de referência, e não foi usado outro navegador nem um contorno de servidor para essa fonte.
  - Sem uma imagem-fonte e a captura da implementação na mesma comparação visual, não é permitido declarar fidelidade visual formal como aprovada.

## Superfícies de fidelidade revisadas na implementação

- Tipografia: Inter e JetBrains Mono carregadas; hierarquia, peso, tracking e quebras revisados no Chrome.
- Espaçamento e ritmo: grid 50/50, seções, cards, planos, formulário e áreas responsivas revisados no desktop.
- Cores e tokens: `#0A0F0C`, `#111814`, `#E8F3EA`, `#7A8B80`, `#1E2A22`, `#3DDC84`, `#1E4A32`, `#F2C94C` e `#FF6B6B` aplicados conforme a direção Terminal.
- Ativos: símbolo Terminal reutilizado a partir do arquivo de marca fornecido; ícones funcionais usam Font Awesome.
- Copy: mensagem principal, linguagem de plantio, recursos e segurança alinhados ao material; preços exibidos foram ajustados aos valores reais do backend (`R$ 17,90` e `R$ 37,90`).

## Interações verificadas

- Home → login e Home → cadastro.
- Âncoras Produto, Recursos, Planos e Segurança.
- Alternância mostrar/ocultar senha.
- Envio de login e apresentação do erro retornado.
- Validação de nome, formato e disponibilidade de e-mail, força de senha, aceite e bloqueio do CTA de cadastro.
- Build, sintaxe JavaScript e typecheck executados sem erro.

## Comparação focada

- Login e cadastro foram inspecionados em capturas próprias porque controles, legibilidade e densidade não ficam avaliáveis na captura da Home.
- A comparação visual focada contra a fonte permanece bloqueada pelo mesmo motivo: ausência de screenshot-fonte capturável.

## Histórico de iteração

1. Primeira renderização local: identificados padding incorreto do hero e herança de cor nos botões.
2. CSS corrigido.
3. Nova captura no mesmo viewport confirmou a correção na implementação.
4. Comparação lado a lado com a fonte não realizada por indisponibilidade da captura visual-fonte.

## Resultado final

final result: blocked

Bloqueador: falta uma captura visual da fonte que possa ser aberta no Chrome e combinada com a implementação para a comparação obrigatória.
