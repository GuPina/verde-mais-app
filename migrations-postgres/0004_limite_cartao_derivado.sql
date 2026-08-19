-- 0004 — `cartoes.limite_disponivel` deixa de ser fonte de verdade.
--
-- O limite disponível passou a ser derivado das faturas em aberto
-- (`card_charges` com status 'pendente'), como já fazia a tela de Cartões.
-- Antes ele existia em dois lugares que discordavam: essa coluna, mantida à
-- mão por 25 UPDATEs espalhados pelo código, e o cálculo pelas faturas.
--
-- Bastava um desses 25 pontos errar para a coluna descolar e nunca mais
-- voltar. E era o que acontecia: alterar o limite do cartão não mexia nela,
-- então o modal de nova despesa continuava mostrando o disponível antigo.
--
-- Este UPDATE recalcula a coluna uma vez, para que nada que ainda a leia
-- (relatório salvo, integração futura) fique com valor absurdo. Daqui para
-- frente ela não é mais atualizada nem consultada para decidir nada.

UPDATE cartoes c
   SET limite_disponivel = GREATEST(0, c.limite_total - COALESCE((
         SELECT SUM(cc.valor) FROM card_charges cc
          WHERE cc.card_id = c.id AND cc.status = 'pendente'), 0));

COMMENT ON COLUMN cartoes.limite_disponivel IS
  'OBSOLETA: nao use. O limite disponivel e derivado de card_charges pendentes — ver src/lib/limite-cartao.ts';
