# Testes de ponta a ponta

Sobem o app de verdade contra um Postgres descartável e exercitam os fluxos que
mexem em dinheiro — criar, parcelar, receber, editar. É a parte que os testes de
`lib/` não alcançam, porque ali tudo é função pura.

## Rodar

```bash
scripts/e2e.sh
```

O script cria um Postgres temporário, aplica as dez migrations, sobe o servidor
numa porta livre, roda os fluxos e derruba tudo no fim — inclusive se um teste
estourar. Nada toca banco de produção: ele se recusa a rodar se `DATABASE_URL`
já estiver apontando para algum lugar.

## O que cada bloco protege

| Bloco | O defeito que ele impede de voltar |
|---|---|
| Portaria | Rota protegida respondendo sem token, ou aceitando token inválido |
| Entrada | Data impossível (31/02), valor negativo, 201 parcelas, texto no lugar de número |
| Cartão | 12 parcelas caindo em menos de 12 faturas — o empilhamento de 2026 |
| Edição | Trocar a CATEGORIA movendo parcela de fatura: foi isto que apagou outubro |
| Recebimento | Total congelado no contratado enquanto o índice já corrigiu as parcelas |
| Isolamento | Uma conta lendo, editando ou apagando lançamento de outra |
| Coerência | Dashboard, Diagnóstico e Projeção divergindo sobre score e confiança |

## Por que o navegador não está aqui

A varredura de telas precisa de Playwright e de uma volta pelas bibliotecas de
CDN (ver o achado sobre dependência externa no relatório de QA). Ela vive em
`tests/e2e/telas.py` e roda à parte, porque depende de um binário de navegador
que nem toda máquina tem.
