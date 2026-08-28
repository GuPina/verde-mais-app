# Design QA — Home, autenticação, Dashboard e pós-cadastro Terminal

## Artefatos

- Fonte visual: `C:\Users\gusta\OneDrive\Documentos\ChatGPT\Verde Mais\referencias-ux\terminal-v3\slides-landing.jsx` e `slides-app-1.jsx`.
- Tokens e marca: `design-tokens.jsx` e `logo.jsx` no mesmo diretório de referência.
- Implementação publicada: `https://verdemais.onrender.com/`, `/login`, `/cadastro`, `/app/dashboard` e `/onboarding`.
- Evidências renderizadas:
  - `design-qa-evidence/home-desktop.png` — 1920 × 855.
  - `design-qa-evidence/login-desktop.png` — 1920 × 855.
  - `design-qa-evidence/cadastro-desktop.png` — 1920 × 855.
  - `design-qa-evidence/dashboard-desktop.png` — 1915 × 887.
  - `design-qa-evidence/dashboard-mobile-final.png` — 390 × 844.
  - `design-qa-evidence/onboarding-desktop.png` — 1920 × 889.
  - `design-qa-evidence/onboarding-step5-desktop.png` — 1920 × 889.
  - `design-qa-evidence/onboarding-mobile.png` — 390 × 844.
- Estados do Dashboard: mês atual, mês futuro, dados populados e layout mobile.
- Estados do pós-cadastro: todas as cinco etapas, seleções, avanço/retorno e última etapa sem efetuar a gravação final na conta de QA.

## Findings

- [P1 — corrigido] Dashboard mobile extrapolava o viewport.
  - Evidência: a primeira captura em 390 px apresentou `scrollWidth` de 1098 px e conteúdo cortado.
  - Causa: larguras mínimas herdadas pelo conteúdo principal e por filhos de grids.
  - Correção: limites de largura no conteúdo, `min-width: 0` nos filhos, navegação inferior apropriada e ocultação do FAB de chat no mobile.
  - Pós-correção: `scrollWidth` de 385 px em viewport de 390 px; `design-qa-evidence/dashboard-mobile-final.png`.

- [P1 — corrigido] Troca de período falhava em execução.
  - Evidência: o módulo acessava `window.VM`, embora `VM` fosse um binding léxico do aplicativo.
  - Impacto: seletores de mês/ano podiam deixar de atualizar o Dashboard.
  - Correção: o módulo passou a reter a instância recebida e todas as ações usam essa referência.
  - Pós-correção: setembro de 2026 exibiu “Período futuro”, aviso de projeção mutável e lista futura vazia.

- [P2 — corrigido] Seletores de período ficavam estreitos no mobile.
  - Correção: grade responsiva dedicada para anterior, mês, ano, próximo, “Hoje” e status.
  - Pós-correção: mês com 124 px e ano com 87 px; valores “Agosto” e “2026” legíveis em 390 px.

- [P2 — corrigido] Coluna de texto do hero público estreita demais.
  - Correção: padding substituído por `clamp(40px, 5vw, 80px)`, restabelecendo a proporção 50/50 e CTAs lado a lado.
  - Pós-correção: `design-qa-evidence/home-desktop.png`.

- [P2 — corrigido] Contraste herdado nos botões dentro de blocos claros.
  - Correção: cores de texto das variantes primária e accent foram explicitadas com seletores escopados.

- [Bloqueador do QA formal] Não existe captura visual exportada do material-fonte.
  - O material recebido contém JSX/HTML de referência, mas não PNG, screenshot ou Figma capturável.
  - Sem imagem-fonte e captura da implementação reunidas na mesma comparação, não é permitido declarar fidelidade visual formal como aprovada.

## Dashboard — melhorias da auditoria incorporadas

- Patrimônio líquido promovido a informação principal, com investimentos, reservas e dívidas discriminados.
- Comprometimento mensal consolidado a partir das obrigações ativas, sem somar parcelas duas vezes.
- Transações recentes filtradas pelo período selecionado e sem lançamentos futuros.
- Estado de mês futuro explícito e sem tratar projeções como valores consolidados.
- Estado de conta vazia orientado por próximos passos, evitando uma parede de zeros.
- Taxa de poupança sem renda exibida como “—”, em vez de percentual enganoso.
- Plural de recomendações corrigido.
- Quitação de empréstimos e financiamentos conectada à ação real do aplicativo.
- Parcelas indicam que já estão incluídas nas despesas.
- Toasts de conquistas empilhados para não ocultar eventos simultâneos.
- Validações específicas para campos ausentes e valores numéricos inválidos.
- APIs de anos e relatório anual protegidas contra ano inválido; faixa aceita entre 2020 e 2100.

## Superfícies revisadas

- Tipografia: Inter e JetBrains Mono; hierarquia, tracking, pesos, quebras e densidade verificados.
- Espaçamento e layout: hero 50/50, grade do Dashboard, cards, formulário, progressão e navegação móvel.
- Cores: tokens Terminal aplicados em superfícies, status, bordas, gráficos e ações.
- Ícones: família Font Awesome consistente, com alinhamento e alvos móveis revisados.
- Copy: linguagem de cultivo, estados futuros, compromisso mensal e orientações de onboarding revisados.
- Responsividade: Home/autenticação no desktop; Dashboard e pós-cadastro em desktop e 390 × 844.
- Acessibilidade: controles semânticos, labels, foco visível, contraste e alvos de toque revisados nas rotas alteradas.

## Interações e testes verificados

- Home → login e Home → cadastro; âncoras principais.
- Mostrar/ocultar senha, erro de login, validação de cadastro e CTA desabilitado.
- Dashboard autenticado com conta de QA, ações principais e troca de período.
- Todas as cinco etapas do pós-cadastro percorridas no Chrome; a gravação final não foi enviada para preservar os dados da conta.
- API: `/api/dashboard/anos` retornou 200; relatório com ano inválido retornou 400; mês inválido retornou 400; mês futuro válido retornou 200.
- Build, sintaxe JavaScript, TypeScript e `git diff --check` executados sem erro.

## Histórico de iteração

1. Implementação Terminal aplicada à Home, autenticação, Dashboard e fluxo pós-cadastro.
2. Primeira renderização identificou padding/contraste no público, referência global quebrada no Dashboard e overflow mobile.
3. Correções aplicadas e publicadas.
4. Nova passagem no Chrome confirmou o período futuro, o fluxo de cinco etapas e a responsividade em 390 × 844.
5. Comparação lado a lado com a fonte permaneceu indisponível por falta de uma captura visual da fonte.

## Resultado final

final result: blocked

Bloqueador: falta uma captura visual da fonte que possa ser aberta no Chrome e combinada com a implementação para a comparação obrigatória. A implementação funcional e os testes de produto estão concluídos.
