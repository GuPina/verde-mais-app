import { Hono } from 'hono'
import { competenciaData, competenciaMes, filtroDespesaDoMes, filtroNaoCancelada, filtroSemAporte } from '../lib/competencia'
import {
  janelaHistorica, renda as calcRenda, dividas as calcDividas, prestacoes as calcPrestacoes,
  comprometimento as calcComprometimento, patrimonio as calcPatrimonio, reserva as calcReserva,
  score as calcScore,
} from '../lib/metricas'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const projecao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/projecao ─────────────────────────────────────────────────────────
projecao.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({
      error: 'Projeção financeira é exclusiva do plano Premium.',
      upgrade: true, feature: 'projecao'
    }, 403)
  }

  // S-P1: parâmetro meses (1–24, default 12)
  const _mesesRaw = c.req.query('meses')
  const _mesesParsed = _mesesRaw !== undefined ? parseInt(_mesesRaw) : NaN
  const mesesParam = Math.min(24, Math.max(1, Number.isNaN(_mesesParsed) ? 12 : _mesesParsed))

  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const mesAtual = hoje.getMonth() + 1

  // ── Histórico e métricas: leitura única, da camada ─────────────────────────
  const janela = await janelaHistorica(c.env.DB, user.id, 12)
  const JANELA_MESES = 12
  // `meses` mantém o mês corrente no fim, marcado, só para a tela poder exibi-lo
  // — nenhum cálculo daqui para baixo o usa.
  const meses = janela.meses.map(m => ({ ...m, parcial: false }))
  const mesesFechados = janela.meses


  // ── Melhoria 2.3: Dados determinísticos do futuro ─────────────────────────
  // 1. Despesas parceladas com status 'pendente' nos próximos meses
  // Usa a data de competência, não só `vencimento`: parcela lançada sem cartão
  // nasce com vencimento NULL, e a query antiga (que filtrava por `vencimento`)
  // simplesmente não a enxergava. Enquanto a média histórica carregava tudo,
  // isso passava despercebido; com a média agora limpa de determinístico, uma
  // parcela invisível aqui sumiria da projeção inteira.
  const parcelasFuturas = await c.env.DB.prepare(`
    SELECT
      strftime('%m', ${competenciaData()}) as mes_venc,
      strftime('%Y', ${competenciaData()}) as ano_venc,
      COALESCE(SUM(valor), 0) as total
    FROM despesas
    WHERE user_id = ? AND status = 'pendente'
      AND ${filtroSemAporte()}
      AND (parcelado = 1 OR COALESCE(numero_parcelas,1) > 1)
      AND (${competenciaData()}) > date('now')
      AND (${competenciaData()}) <= date('now', '+12 months')
    GROUP BY mes_venc, ano_venc
  `).bind(user.id).all()

  // 2. Recorrências ativas (geram despesa todo mês)
  // NOTA: coluna correta é 'ativa' (não 'ativo').
  // PJ6: 'fixa' não existe como tipo de recorrência (só 'despesa'/'receita') —
  // cláusula removida por nunca casar.
  const recorrenciasAtivas = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(valor), 0) as total_mensal
    FROM recorrencias
    WHERE user_id = ? AND ativa = 1 AND tipo = 'despesa'
      AND (data_fim IS NULL OR data_fim > date('now'))
  `).bind(user.id).first() as any

  // 2b. PJ3: receita recorrente (ex.: salário cadastrado como recorrência).
  // Antes só o lado da DESPESA era projetado, deixando a renda subprojetada
  // para quem tem o salário como recorrência — projeção pessimista sistemática.
  const recorrenciasReceita = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(valor), 0) as total_mensal
    FROM recorrencias
    WHERE user_id = ? AND ativa = 1 AND tipo = 'receita'
      AND (data_fim IS NULL OR data_fim > date('now'))
  `).bind(user.id).first() as any

  // 3. Lembretes ativos com valor estimado e vencimento próximo (até 3 meses)
  // Colunas reais: valor_estimado, ativo, proximo_vencimento
  const lembretesValor = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(valor_estimado), 0) as total
    FROM lembretes
    WHERE user_id = ? AND ativo = 1
      AND valor_estimado IS NOT NULL AND valor_estimado > 0
      AND proximo_vencimento IS NOT NULL
      AND proximo_vencimento > date('now')
      AND proximo_vencimento <= date('now', '+3 months')
  `).bind(user.id).first() as any

  // Construir mapa de despesas determinísticas por mês
  const parcelasMap: Record<string, number> = {}
  for (const row of (parcelasFuturas.results as any[])) {
    const key = `${row.ano_venc}-${row.mes_venc}`
    parcelasMap[key] = parseFloat(row.total)
  }

  const recorrenciaMensal = parseFloat(recorrenciasAtivas?.total_mensal || 0)
  const recorrenciaReceitaMensal = parseFloat(recorrenciasReceita?.total_mensal || 0) // PJ3
  const lembretesTotal = parseFloat(lembretesValor?.total || 0)

  // ── Janela, médias e confiança: tudo vem da camada de métricas ─────────────
  //
  // Este bloco reimplementava aqui dentro o que agora mora em src/lib/metricas.ts:
  // janela de meses fechados, detecção de mês atípico, média ponderada. Duas
  // cópias da mesma regra divergem na primeira correção que alguém faz só de um
  // lado — foi assim que o app passou a ter três scores. A rota agora só lê.
  const mesesComDados = janela.meses
  const mesesAtipicos = janela.atipicos
  const baseFinal = janela.base

  const pesosBase = baseFinal.map((_, i) => baseFinal.length > 1 ? 1 + (2 * i) / (baseFinal.length - 1) : 1)
  const somaPesos = pesosBase.reduce((a, b) => a + b, 0) || 1
  const mediaPesada = (vals: number[]) => vals.reduce((acc, v, i) => acc + v * pesosBase[i], 0) / somaPesos

  const saldos = baseFinal.map(m => m.saldo)
  const mediaPonderada = saldos.length ? mediaPesada(saldos) : 0

  // Confiança: dispersão normalizada pela RENDA, não pela média dos saldos.
  // Dividir pela média do saldo explode quando ela é perto de zero — que é o
  // caso de quem fecha o mês empatado, justamente quem mais precisa da
  // projeção. Antes o número exibido era sempre o piso de 45.
  const receitaRef = baseFinal.length ? mediaPesada(baseFinal.map(m => m.receitas)) : 0
  const desvioSaldo = saldos.length
    ? Math.sqrt(saldos.reduce((acc, v, i) => acc + pesosBase[i] * Math.pow(v - mediaPonderada, 2), 0) / somaPesos)
    : 0
  const LIMITE_VOLATILIDADE = 0.6
  const volatilidade = receitaRef > 0 ? desvioSaldo / receitaRef : 1
  const fatorAmostra = Math.min(1, baseFinal.length / 6)
  const fatorEstabilidade = Math.max(0, Math.min(1, 1 - volatilidade / LIMITE_VOLATILIDADE))
  const confianca = baseFinal.length === 0
    ? 0
    : Math.max(5, Math.round(100 * fatorAmostra * fatorEstabilidade))


  // PJ1: a "tendência" e a "projeção" precisam vir da MESMA fonte. Antes a
  // tendência era uma regressão sobre os 6 meses do histórico (incluindo os
  // vazios → inclinação negativa "queda") enquanto a projeção usava só os meses
  // com dados (→ sobe), e a tela exibia as duas afirmações contraditórias lado
  // a lado. Agora a tendência é derivada da própria linha projetada (definida
  // logo após o cálculo das projeções, abaixo).
  let tendencia: 'positive' | 'negative' | 'stable' = 'stable'
  let deltaMensalProjetado = 0

  // ── Ponto de partida da linha projetada ────────────────────────────────────
  //
  // Era a soma dos resultados dos últimos 6 meses. Esse número não é o saldo
  // da conta de ninguém, não é patrimônio e não é dívida — é a soma de seis
  // sobras mensais, que muda de sentido conforme a janela. Um usuário lia
  // "Ponto de partida: R$ 399" e entendia que tinha R$ 399 no banco.
  //
  // A linha agora parte de ZERO e responde a única pergunta que ela sabe
  // responder de verdade: quanto você ACUMULA (ou consome) daqui para a
  // frente, mês a mês. O resultado dos meses fechados continua na resposta,
  // como contexto, com nome próprio.
  const saldoAtual = 0
  const resultado6mFechados = mesesFechados.slice(-6).reduce((acc, m) => acc + m.saldo, 0)

  // ── Projeções com dados determinísticos ───────────────────────────────────
  const INFLACAO_MENSAL = 0.003
  const mesesNomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const projecoes: Array<{ mes: number; ano: number; label: string; valor: number; receitas: number; despesas: number; deterministica: number; tem_dados_reais: boolean }> = []
  
  // As médias saem da mesma base limpa que alimenta a confiança: meses
  // fechados, com os dois lados lançados, sem os atípicos, com o mês recente
  // pesando mais. Antes eram os 6 meses crus, mês corrente incluído.
  const avgReceitas = baseFinal.length > 0 ? mediaPesada(baseFinal.map(m => m.receitas)) : 0
  // ── Contagem dupla (corrigida) ──────────────────────────────────────────
  // Antes: despesa projetada = média histórica TOTAL + recorrências + parcelas
  // futuras. Só que a média histórica já continha as parcelas e recorrências
  // lançadas naqueles meses — então tudo isso entrava duas vezes e a projeção
  // saía sistematicamente pessimista para quem tem parcelamento ou conta fixa,
  // que é quase todo mundo.
  //
  // Medido em produção antes da correção: média histórica R$ 10.682 e despesa
  // projetada para o mês seguinte R$ 12.552, sendo R$ 1.750 de determinístico
  // somado por cima de uma média que já o continha.
  //
  // Agora a média é só da parte VARIÁVEL (mercado, lazer, imprevisto) e o que
  // é contratado — parcelas e recorrências — entra uma vez só, pelo valor real
  // de cada mês futuro. Onde há certeza, usa-se o número exato; onde não há,
  // a média.
  const avgDespesas = baseFinal.length > 0 ? mediaPesada(baseFinal.map(m => m.despesas_variaveis)) : 0

  let saldoAcum = saldoAtual
  for (let i = 1; i <= mesesParam; i++) {
    let m = mesAtual + i
    let a = anoAtual
    while (m > 12) { m -= 12; a += 1 }
    // Receita estável (sem crescimento automático) + receita recorrente (PJ3)
    const recProj = avgReceitas + recorrenciaReceitaMensal
    // Despesa base com inflação acumulada
    let despProj = avgDespesas * Math.pow(1 + INFLACAO_MENSAL, i)
    // Melhoria 2.3: adicionar recorrências mensais determinísticas
    despProj += recorrenciaMensal

    // Adicionar parcelas parceladas determinísticas deste mês
    const keyMes = `${String(a)}-${String(m).padStart(2, '0')}`
    const deterministica = parcelasMap[keyMes] || 0
    despProj += deterministica

    // Adicionar 1/12 dos lembretes (distribuídos uniformemente)
    if (i <= 3) despProj += lembretesTotal / 3

    saldoAcum += (recProj - despProj)
    projecoes.push({
      mes: m, ano: a,
      label: `${mesesNomes[m-1]}/${a}`,
      valor: Math.round(saldoAcum * 100) / 100,
      receitas: Math.round(recProj * 100) / 100,
      despesas: Math.round(despProj * 100) / 100,
      deterministica: Math.round(deterministica * 100) / 100,
      tem_dados_reais: deterministica > 0 || recorrenciaMensal > 0
    })
  }

  // PJ1: tendência derivada da própria projeção (mesma fonte da linha do gráfico)
  deltaMensalProjetado = mesesParam > 0 ? (saldoAcum - saldoAtual) / mesesParam : 0
  tendencia = deltaMensalProjetado > 50 ? 'positive' : deltaMensalProjetado < -50 ? 'negative' : 'stable'

  // ── Insights personalizados ────────────────────────────────────────────────
  const insights: string[] = []
  if (tendencia === 'positive') {
    insights.push(`📈 Tendência positiva! Seu saldo mensal cresce em média R$ ${Math.abs(deltaMensalProjetado).toFixed(0)}/mês.`)
  } else if (tendencia === 'negative') {
    insights.push(`⚠️ Atenção: seu saldo mensal cai em média R$ ${Math.abs(deltaMensalProjetado).toFixed(0)}/mês. Revise suas despesas.`)
  } else {
    insights.push(`📊 Seu saldo está estável. Considere aumentar suas receitas ou criar metas de poupança.`)
  }

  if (avgReceitas === 0 && avgDespesas === 0) {
    insights.push(`📥 Comece lançando suas receitas e despesas para obter uma projeção precisa do seu futuro financeiro.`)
  } else {
    // Comparar receita com a média VARIÁVEL subestimava a saída em duas
    // camadas inteiras (recorrências e parcelas) — a tela dizia "sobra 60%"
    // para quem não fecha o mês. A saída aqui é a saída completa.
    const saidaTotalMes = avgDespesas + recorrenciaMensal
      + (Object.values(parcelasMap).reduce((a, b) => a + b, 0) / Math.max(1, mesesParam))
    const entradaTotalMes = avgReceitas + recorrenciaReceitaMensal
    if (saidaTotalMes > entradaTotalMes) {
      insights.push(`🚨 Sai mais do que entra: R$ ${saidaTotalMes.toFixed(0)}/mês contra R$ ${entradaTotalMes.toFixed(0)}/mês de receita. A diferença é coberta por saldo anterior — enquanto durar.`)
    } else {
      const txPoupanca = entradaTotalMes > 0 ? ((entradaTotalMes - saidaTotalMes) / entradaTotalMes * 100).toFixed(1) : '0.0'
      insights.push(`💰 Você guarda ${txPoupanca}% do que recebe, já pagando tudo. ${parseFloat(txPoupanca) >= 20 ? 'Está acima dos 20% que se costuma recomendar.' : 'A referência usual é 20% — a distância até lá é o seu próximo alvo.'}`)
    }
  }

  // Melhoria 2.3: alertas de despesas determinísticas
  if (recorrenciaMensal > 0) {
    insights.push(`🔄 ${recorrenciaMensal > 0 ? `R$ ${recorrenciaMensal.toFixed(0)}/mês em recorrências ativas foram incluídos nas projeções.` : ''}`)
  }
  if (Object.keys(parcelasMap).length > 0) {
    const totalParc = Object.values(parcelasMap).reduce((a, b) => a + b, 0)
    insights.push(`📋 R$ ${totalParc.toFixed(0)} em parcelas futuras identificadas foram incluídas na projeção dos próximos 12 meses.`)
  }

  const proj6 = projecoes[5]?.valor || 0
  const proj12 = projecoes[11]?.valor || 0
  if (proj12 > saldoAtual) {
    insights.push(`🔮 Em 12 meses, seu patrimônio acumulado pode chegar a R$ ${proj12.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`)
  } else if (proj12 < saldoAtual) {
    insights.push(`⚠️ Em 12 meses, despesas recorrentes e inflação podem reduzir seu saldo acumulado para R$ ${proj12.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`)
  }

  // ── S-P2: Projeção patrimonial com investimentos ──────────────────────────
  const investimentosAtivos = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(valor_atual), 0) as total_atual,
           COALESCE(SUM(valor_investido), 0) as total_investido
    FROM investimentos WHERE user_id = ?
  `).bind(user.id).first() as any

  const totalInvestimentos = parseFloat(investimentosAtivos?.total_atual || 0)
  const totalInvestido = parseFloat(investimentosAtivos?.total_investido || 0)
  const rendimentoMensal = totalInvestido > 0
    ? (totalInvestimentos - totalInvestido) / totalInvestido / Math.max(1, 1) // retorno médio simplificado
    : 0

  // Buscar CDI atual para projeção de rendimento
  const cdiCache = await c.env.DB.prepare(
    `SELECT valor_brl FROM cotacoes_cache WHERE tipo='selic' ORDER BY atualizado_em DESC LIMIT 1`
  ).bind().first() as any
  const cdiAnual = parseFloat(cdiCache?.valor_brl || 14.9)
  const cdiMensal = Math.pow(1 + cdiAnual / 100, 1 / 12) - 1

  // S-P3: Cenários otimista / pessimista (±1 desvio padrão)
  const cenarioOtimista: any[] = []
  const cenarioPessimista: any[] = []
  let saldoOtim = saldoAtual
  let saldoPess = saldoAtual

  for (let i = 1; i <= mesesParam; i++) {
    let m = mesAtual + i
    let a = anoAtual
    while (m > 12) { m -= 12; a += 1 }
    const mesesNomesC = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    const label = `${mesesNomesC[m-1]}/${a}`
    const keyMes = `${String(a)}-${String(m).padStart(2, '0')}`
    const detMin = parcelasMap[keyMes] || 0

    // Otimista: receitas +10%, despesas -5%
    const recOtim = (avgReceitas + recorrenciaReceitaMensal) * 1.10
    const despOtim = (avgDespesas * Math.pow(1 + INFLACAO_MENSAL, i) * 0.95) + recorrenciaMensal + detMin
    saldoOtim += (recOtim - despOtim)
    cenarioOtimista.push({ mes: m, ano: a, label, valor: Math.round(saldoOtim * 100) / 100 })

    // Pessimista: receitas -10%, despesas +10%
    const recPess = (avgReceitas + recorrenciaReceitaMensal) * 0.90
    const despPess = (avgDespesas * Math.pow(1 + INFLACAO_MENSAL, i) * 1.10) + recorrenciaMensal + detMin
    saldoPess += (recPess - despPess)
    cenarioPessimista.push({ mes: m, ano: a, label, valor: Math.round(saldoPess * 100) / 100 })
  }

  // Conquista: consultou projeção (projetor + projecao_vista + viu_projecao do Bloco 5)
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(user.id, 'projetor').run().catch(() => {})
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(user.id, 'projecao_vista').run().catch(() => {})
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(user.id, 'viu_projecao').run().catch(() => {})

  // ── BLOCO 6.3: Integração Projeção → Metas ─────────────────────────────────
  // Verificar se metas ativas serão atingíveis com a projeção atual
  const metasAtivas = await c.env.DB.prepare(`
    SELECT id, nome, valor_objetivo, valor_atual, data_meta
    FROM metas WHERE user_id = ? AND status = 'ativa' AND data_meta IS NOT NULL
    ORDER BY data_meta ASC LIMIT 5
  `).bind(user.id).all()

  const metas_analise = (metasAtivas.results as any[]).map(meta => {
    const faltante = parseFloat(meta.valor_objetivo) - parseFloat(meta.valor_atual)
    const dataMeta = new Date(meta.data_meta)
    const hoje = new Date()
    const mesesRestantes = Math.max(0, Math.ceil((dataMeta.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 30)))
    const poupancaNecessaria = mesesRestantes > 0 ? faltante / mesesRestantes : faltante
    const viavel = mediaPonderada >= poupancaNecessaria
    return {
      id: meta.id,
      nome: meta.nome,
      valor_faltante: Math.round(faltante * 100) / 100,
      meses_restantes: mesesRestantes,
      poupanca_necessaria_mes: Math.round(poupancaNecessaria * 100) / 100,
      viavel_com_projecao: viavel,
      alerta: !viavel ? `⚠️ Meta "${meta.nome}" pode não ser atingida: você precisa poupar R$ ${poupancaNecessaria.toFixed(0)}/mês mas seu saldo médio é R$ ${mediaPonderada.toFixed(0)}/mês.` : null
    }
  })

  // Adicionar alertas de metas aos insights
  for (const meta of metas_analise) {
    if (meta.alerta) insights.push(meta.alerta)
  }

  // ── Leitura de cenário ──────────────────────────────────────────────────────
  // A tela mostrava três números (otimista, base, pessimista) e nenhuma
  // conclusão. Três números sem leitura não são análise: o que decide algo é
  // saber QUANDO o dinheiro acaba, O QUE está puxando o resultado, e QUANTO
  // uma mudança de hábito muda o fim do ano.
  const cruzaZero = (serie: any[]) => {
    const i = serie.findIndex(p => Number(p.valor) < 0)
    return i === -1 ? null : { mes_indice: i + 1, label: serie[i].label, valor: Number(serie[i].valor) }
  }

  const totalParcelasFuturas = Object.values(parcelasMap).reduce((a: number, b: any) => a + Number(b), 0)
  const parcelaMediaMes = totalParcelasFuturas / Math.max(1, mesesParam)
  // O mês em que o peso das parcelas cai pela metade — é a folga que já está
  // contratada e que ninguém enxerga olhando só o saldo de hoje.
  const mesesOrdenados = Object.keys(parcelasMap).sort()
  const pico = mesesOrdenados.length ? Number(parcelasMap[mesesOrdenados[0]]) : 0
  const mesAlivio = mesesOrdenados.find(k => Number(parcelasMap[k]) <= pico / 2) || null

  const saidaMensal = avgDespesas + recorrenciaMensal + parcelaMediaMes
  const entradaMensal = avgReceitas + recorrenciaReceitaMensal
  const composicao = [
    { rotulo: 'Receitas', valor: Math.round(entradaMensal * 100) / 100, sinal: 1,
      detalhe: recorrenciaReceitaMensal > 0 ? 'média dos últimos meses + recorrentes' : 'média dos últimos meses' },
    { rotulo: 'Despesa variável', valor: Math.round(avgDespesas * 100) / 100, sinal: -1,
      detalhe: 'mercado, lazer, imprevistos — a parte que dá para mexer' },
    { rotulo: 'Recorrências', valor: Math.round(recorrenciaMensal * 100) / 100, sinal: -1,
      detalhe: 'assinaturas e contas fixas já contratadas' },
    { rotulo: 'Parcelas', valor: Math.round(parcelaMediaMes * 100) / 100, sinal: -1,
      detalhe: `${Math.round(totalParcelasFuturas)} reais espalhados em ${mesesParam} meses` },
  ]

  const sobra = entradaMensal - saidaMensal
  const analise = {
    composicao,
    sobra_mensal: Math.round(sobra * 100) / 100,
    // Peso de cada saída sobre a receita: é onde a conta aperta.
    pct_comprometido: entradaMensal > 0
      ? Math.round(((recorrenciaMensal + parcelaMediaMes) / entradaMensal) * 1000) / 10 : 0,
    pct_variavel: entradaMensal > 0 ? Math.round((avgDespesas / entradaMensal) * 1000) / 10 : 0,
    // Quando cada cenário vira negativo, se virar.
    zera_base: cruzaZero(projecoes),
    zera_pessimista: cruzaZero(cenarioPessimista),
    // Sensibilidade: quanto muda o fim do horizonte para cada R$ 100/mês.
    impacto_100_por_mes: Math.round(100 * mesesParam * 100) / 100,
    mes_alivio_parcelas: mesAlivio
      ? { chave: mesAlivio, valor: Math.round(Number(parcelasMap[mesAlivio]) * 100) / 100, pico: Math.round(pico * 100) / 100 }
      : null,
    // Quanto separar por mês para fechar o horizonte no positivo, se hoje
    // ele fecha negativo.
    ajuste_necessario: sobra < 0 ? Math.round(Math.abs(sobra) * 100) / 100 : 0,
    horizonte_meses: mesesParam,
  }

  // ── Camada explicativa ─────────────────────────────────────────────────────
  //
  // A tela mostrava números corretos que ninguém sabia ler. "Confiança 45%",
  // "ponto de partida R$ 399", "despesa variável" — cada um desses exige um
  // parágrafo de contexto que não estava em lugar nenhum, e sem o contexto o
  // usuário ou ignora o número ou tira dele a conclusão errada. O texto é
  // gerado aqui, junto do cálculo, porque quem sabe o que o número significa
  // é quem acabou de fazê-lo.
  const brl = (v: number) => 'R$ ' + (Math.round(Number(v) || 0)).toLocaleString('pt-BR')

  const fraseConfianca = (() => {
    if (baseFinal.length === 0) {
      return 'Ainda não há nenhum mês fechado com receita e despesa lançadas. Sem isso não dá para projetar nada — a linha acima é só a soma do que já está contratado.'
    }
    const partes: string[] = []
    partes.push(`A projeção olhou ${baseFinal.length} ${baseFinal.length === 1 ? 'mês fechado' : 'meses fechados'} (${baseFinal[0].label} a ${baseFinal[baseFinal.length - 1].label}).`)
    if (baseFinal.length < 6) {
      partes.push(`Com menos de 6 meses a amostra ainda é curta, e isso sozinho já limita a confiança a ${fatorAmostra * 100}%.`)
    } else {
      partes.push('Isso é histórico suficiente — a amostra não é o problema.')
    }
    partes.push(`O que pesa é a oscilação: seu resultado mensal varia cerca de ${brl(desvioSaldo)} para cima ou para baixo, o que dá ${Math.round(volatilidade * 100)}% da sua renda média de ${brl(receitaRef)}.`)
    if (volatilidade < 0.15) partes.push('Seus meses se parecem muito entre si, então dá para confiar bastante na projeção.')
    else if (volatilidade < 0.3) partes.push('É uma variação normal para quem tem renda variável ou gasto sazonal: a projeção serve para decidir, mas não para o centavo.')
    else partes.push('Meses muito diferentes entre si tornam qualquer média fraca — trate os números como ordem de grandeza, não como previsão.')
    if (mesesAtipicos.length) {
      const nomes = mesesAtipicos.map(x => `${x.label} (${x.motivo})`).join(', ')
      partes.push(`${mesesAtipicos.length === 1 ? 'Um mês ficou de fora' : `${mesesAtipicos.length} meses ficaram de fora`} da média por fugir demais do seu padrão: ${nomes}. Sem essa exclusão, um único mês fora da curva distorceria todo o resto.`)
    }
    if (meses.find(m => m.parcial)) {
      partes.push(`O mês em curso (${meses.find(m => m.parcial)!.label}) também não entra: ele ainda não terminou, e contá-lo faria a receita parecer menor e a despesa maior do que são.`)
    }
    return partes.join(' ')
  })()

  const explicacoes = {
    confianca: fraseConfianca,
    como_ler: [
      { titulo: 'A linha do gráfico', texto: 'Ela começa em zero e mostra quanto dinheiro sobra ou falta, somado mês a mês, a partir de hoje. Subindo, você acumula; descendo, você consome.' },
      { titulo: 'Por que ela não é o seu saldo no banco', texto: 'O sistema não conhece o saldo da sua conta. Ele conhece o que entra e o que sai. A projeção mede a diferença entre os dois ao longo do tempo — some o seu saldo de hoje por fora, se quiser o número absoluto.' },
      { titulo: 'O que já é certo e o que é chute', texto: 'Parcelas e recorrências entram pelo valor exato de cada mês: são contas que já existem. Mercado, lazer e imprevisto entram pela sua média: são estimativa. Quanto maior o peso do certo, mais firme a projeção.' },
      { titulo: 'Os três cenários', texto: 'O do meio é o seu padrão repetido. O de cima supõe ganhar 10% a mais e gastar 5% a menos; o de baixo, ganhar 10% a menos e gastar 10% a mais. Não são previsões — são as bordas dentro das quais sua vida provavelmente cabe.' },
    ],
    glossario: [
      { termo: 'Despesa variável', texto: 'O que muda de mês para mês e você consegue mexer: mercado, restaurante, combustível, lazer. Não inclui parcela nem assinatura.' },
      { termo: 'Recorrência', texto: 'Conta que se repete todo mês por prazo indefinido: aluguel, escola, streaming, plano de saúde.' },
      { termo: 'Parcela', texto: 'Compra passada que você ainda está pagando. Já está contratada, então a projeção usa o valor exato de cada mês, não uma média.' },
      { termo: 'Comprometido', texto: 'Quanto da sua renda já tem destino antes de você decidir qualquer coisa no mês. Acima de 40% sobra pouca margem para imprevisto.' },
      { termo: 'Sobra por mês', texto: 'Receita menos tudo: variável, recorrências e a média das parcelas. É esse número, positivo ou negativo, que inclina a linha do gráfico.' },
      { termo: 'Confiança', texto: 'O quanto os seus meses se parecem entre si, combinado com quanto histórico existe. Não é a chance de o número acontecer — é o quanto vale a pena levá-lo a sério.' },
    ],
  }

  // ══ BALANÇO, ENDIVIDAMENTO, PLANO E CALENDÁRIO ═══════════════════════════════
  //
  // A Projeção deixa de ser só o filme e passa a abrir pelo retrato. Todos os
  // números daqui saem da camada de métricas — nenhum é somado nesta rota.
  const rendaM = await calcRenda(c.env.DB, user.id, janela)
  const divs = await calcDividas(c.env.DB, user.id)
  const prest = await calcPrestacoes(c.env.DB, user.id)
  const comp = calcComprometimento(prest.total, rendaM.mensal)
  const patr = await calcPatrimonio(c.env.DB, user.id, divs.total)
  const res = calcReserva(patr.reserva, janela, 6)

  const sobraProximoMes = projecoes.length ? Number(projecoes[0].receitas) - Number(projecoes[0].despesas) : 0

  const sc = calcScore({
    reserva: res, comprometimento: comp, sobra_proximo_mes: sobraProximoMes,
    renda: rendaM.mensal, patrimonio: patr, janela,
  })

  // ── Plano de quitação ──────────────────────────────────────────────────────
  //
  // Bola de neve ataca o menor saldo (vitória rápida); avalanche, o maior juro
  // (menos juro pago). Nos dois, a parcela de quem termina rola para o próximo
  // — é o rolo que encurta o plano, não o esforço extra sozinho.
  //
  // O financiamento que ainda não começou fica de fora: não dá para "quitar
  // primeiro" uma prestação que ainda não saiu da conta.
  const alvos: Array<{ nome: string; saldo: number; parcela: number; taxa: number }> = []
  if (divs.cartoes > 0 && prest.cartao_parcelado > 0) {
    alvos.push({ nome: 'Cartões', saldo: divs.cartoes, parcela: prest.cartao_parcelado, taxa: 0 })
  }
  for (const d of divs.lista) {
    if (!d.vigente || d.tipo === 'cartao' || d.parcela <= 0) continue
    alvos.push({ nome: d.nome, saldo: d.saldo, parcela: d.parcela, taxa: d.taxa_mensal })
  }

  const extraRaw = c.req.query('extra')
  const extra = Math.max(0, Number.isFinite(Number(extraRaw)) ? Number(extraRaw) : 0)

  function simular(ordem: 'neve' | 'avalanche', aporteExtra: number) {
    const fila = alvos.map(a => ({ ...a }))
    fila.sort((a, b) => ordem === 'neve' ? a.saldo - b.saldo : (b.taxa - a.taxa) || (a.saldo - b.saldo))
    let mes = 0, juros = 0, pago = 0
    let rolo = aporteExtra
    const quitacoes: Array<{ nome: string; mes: number }> = []
    const TETO = 600
    while (fila.some(f => f.saldo > 0.01) && mes < TETO) {
      mes++
      let sobra = rolo
      for (const f of fila) {
        if (f.saldo <= 0.01) continue
        const j = Math.round(f.saldo * (f.taxa / 100) * 100) / 100
        juros += j
        let pagamento = f.parcela
        if (sobra > 0) { pagamento += sobra; sobra = 0 }
        const devido = f.saldo + j
        const efetivo = Math.min(pagamento, devido)
        pago += efetivo
        f.saldo = Math.round((devido - efetivo) * 100) / 100
        if (f.saldo <= 0.01) {
          f.saldo = 0
          quitacoes.push({ nome: f.nome, mes })
          rolo += f.parcela   // a parcela de quem terminou passa para o próximo
        }
      }
    }
    return {
      meses: mes, juros: Math.round(juros * 100) / 100,
      total_pago: Math.round(pago * 100) / 100, quitacoes,
      // Quem recebe o esforço extra. É o alvo da estratégia — não confundir
      // com quem termina primeiro, que costuma ser outro por causa do rolo.
      alvo: fila.length ? fila[0].nome : null,
    }
  }

  const temAlvo = alvos.length > 0
  const neve = temAlvo ? simular('neve', extra) : null
  const avalanche = temAlvo ? simular('avalanche', extra) : null
  const semExtra = temAlvo ? simular('neve', 0) : null

  const plano_quitacao = {
    extra,
    divida_alvo: Math.round(alvos.reduce((s, a) => s + a.saldo, 0) * 100) / 100,
    parcela_alvo: Math.round(alvos.reduce((s, a) => s + a.parcela, 0) * 100) / 100,
    bola_de_neve: neve,
    avalanche,
    sem_esforco_extra: semExtra,
    // Quando a dívida de menor saldo é também a de maior juro, as duas
    // estratégias apontam para o mesmo lugar e não há contrapartida a ponderar.
    // Compara o ALVO de cada uma, não quem termina primeiro — com o rolo da
    // parcela, quem termina primeiro costuma ser outro.
    concordam: !!(neve && avalanche && neve.alvo && neve.alvo === avalanche.alvo),
    alvo_neve: neve?.alvo ?? null,
    alvo_avalanche: avalanche?.alvo ?? null,
    dividas: alvos.map(a => ({ ...a, saldo: Math.round(a.saldo * 100) / 100 })),
  }

  // ── Calendário: o ritmo, com data ──────────────────────────────────────────
  //
  // Média é um número; ritmo é um calendário. Como cada compromisso tem começo
  // e fim, dá para dizer quando aperta, quando alivia e quando entra algo novo.
  const rotulo = (n: number) => {
    let m = mesAtual + n, a = anoAtual
    while (m > 12) { m -= 12; a += 1 }
    return `${mesesNomes[m - 1]}/${a}`
  }
  const eventos: Array<{ quando: string; tipo: string; titulo: string; detalhe: string; valor: number }> = []
  const cruza = projecoes.findIndex(p => Number(p.valor) < 0)
  if (cruza >= 0) {
    eventos.push({ quando: projecoes[cruza].label, tipo: 'aperto', titulo: 'O caixa fica negativo',
      detalhe: 'Somando o que entra e o que sai a partir de hoje, é aqui que o acumulado vira vermelho.',
      valor: Number(projecoes[cruza].valor) })
  }
  const pior = projecoes.reduce((min, p) => (Number(p.valor) < Number(min.valor) ? p : min), projecoes[0] || { valor: 0, label: '' } as any)
  if (pior && Number(pior.valor) < 0) {
    eventos.push({ quando: pior.label, tipo: 'fundo', titulo: 'Fundo do poço',
      detalhe: 'Daqui em diante as parcelas começam a acabar e a maré vira.', valor: Number(pior.valor) })
  }
  if (neve && neve.meses > 0 && neve.meses < 600) {
    eventos.push({ quando: rotulo(neve.meses), tipo: 'alivio', titulo: 'Dívida de consumo zerada',
      detalhe: `No ritmo atual${extra > 0 ? ' com o esforço extra' : ''}, tudo que hoje tem parcela está pago.`,
      valor: plano_quitacao.parcela_alvo })
  }
  for (const d of divs.lista) {
    if (d.vigente || !d.comeca_em) continue
    const ini = new Date(d.comeca_em + 'T12:00:00')
    const dif = (ini.getFullYear() - anoAtual) * 12 + (ini.getMonth() + 1 - mesAtual)
    if (dif > 0) {
      eventos.push({ quando: rotulo(dif), tipo: 'novo', titulo: `1ª parcela · ${d.nome}`,
        detalhe: 'Compromisso já assinado que começa a sair da conta nesta data.', valor: -d.parcela })
    }
  }
  eventos.sort((a, b) => {
    const pa = projecoes.findIndex(p => p.label === a.quando)
    const pb = projecoes.findIndex(p => p.label === b.quando)
    return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb)
  })

  // "Cabe?" — a folga que a dívida libera contra a prestação que vai entrar.
  const futuras = divs.lista.filter(d => !d.vigente && d.parcela > 0)
  const teste_de_caber = futuras.length ? {
    prestacao_futura: Math.round(futuras.reduce((s, d) => s + d.parcela, 0) * 100) / 100,
    comeca_em: futuras[0].comeca_em,
    folga_liberada: plano_quitacao.parcela_alvo,
    meses_ate_liberar: neve ? neve.meses : null,
    cabe: neve ? plano_quitacao.parcela_alvo >= futuras.reduce((s, d) => s + d.parcela, 0) : null,
  } : null

  const balanco = {
    tem: { total: patr.total, detalhe: patr.detalhe,
      bens_quitados: patr.bens_quitados, bens_em_formacao: patr.bens_em_formacao,
      investimentos: patr.investimentos, reserva: patr.reserva },
    deve: { total: divs.total, vigente: divs.vigente, contratada: divs.contratada,
      cartoes: divs.cartoes, emprestimos: divs.emprestimos,
      financiamentos: divs.financiamentos, entradas: divs.entradas, lista: divs.lista },
    renda: rendaM,
    patrimonio_liquido: patr.liquido,
    indices: {
      disponibilidade: patr.pct_disponibilidade,
      imobilizacao: patr.pct_imobilizacao,
      gera_renda: patr.pct_gera_renda,
      reserva_meses: res.meses_cobertos,
    },
    reserva: res,
  }

  const endividamento = {
    comprometimento: comp,
    limite_sugerido: 30,
    prestacoes: prest.total,
    detalhe: prest.detalhe,
    sobra_depois_das_prestacoes: Math.round((rendaM.mensal - prest.total) * 100) / 100,
    // Os 30% são referência de mercado, não regra: quem ganha muito e
    // compromete 40% vive melhor que quem ganha pouco e compromete 25%.
    nota: 'Os 30% são uma referência, não uma regra. O que decide é quanto sobra em reais depois das prestações.',
  }

  return c.json({
    historico: meses,
    explicacoes,
    // ── O retrato, novo ──────────────────────────────────────────────────────
    balanco,
    endividamento,
    plano_quitacao,
    calendario: eventos,
    teste_de_caber,
    score: sc,
    analise,
    projecoes,
    // S-P3: cenários otimista / pessimista
    cenarios: {
      base: projecoes,
      otimista: cenarioOtimista,
      pessimista: cenarioPessimista
    },
    tendencia,
    // PJ2: "média mensal" agora reflete a sobra REAL — receita (incl. recorrente)
    // menos a despesa variável média E o que já está contratado (recorrências +
    // parcelas futuras diluídas no horizonte). O valor antigo (só variável)
    // prometia um superávit que só existia se nada contratado fosse pago.
    media_mensal: Math.round((
      (avgReceitas + recorrenciaReceitaMensal)
      - avgDespesas - recorrenciaMensal
      - (Object.values(parcelasMap).reduce((a, b) => a + b, 0) / Math.max(1, mesesParam))
    ) * 100) / 100,
    media_mensal_variavel: Math.round((avgReceitas - avgDespesas) * 100) / 100,
    media_receitas: Math.round((avgReceitas + recorrenciaReceitaMensal) * 100) / 100,
    // `media_despesas` agora é a média da parte VARIÁVEL. O que é contratado
    // aparece separado em `dados_certos`, para a tela poder mostrar as duas
    // camadas — o que já está fechado e o que é estimativa.
    media_despesas: Math.round(avgDespesas * 100) / 100,
    media_despesas_variaveis: Math.round(avgDespesas * 100) / 100,
    media_despesas_total_historica: Math.round(
      (baseFinal.length > 0 ? mediaPesada(baseFinal.map(m => m.despesas)) : 0) * 100) / 100,
    saldo_atual: 0,
    saldo_atual_desc: 'A linha começa do zero: ela mostra quanto você acumula a partir de hoje, não quanto você tem no banco.',
    resultado_6m_fechados: Math.round(resultado6mFechados * 100) / 100,
    confianca,
    confianca_detalhe: {
      nivel: confianca >= 70 ? 'alta' : confianca >= 40 ? 'média' : 'baixa',
      meses_usados: baseFinal.length,
      meses_labels: baseFinal.map(m => m.label),
      janela_maxima: JANELA_MESES,
      mes_corrente_ignorado: meses.find(m => m.parcial)?.label || null,
      meses_atipicos: mesesAtipicos,
      oscilacao_mensal: Math.round(desvioSaldo * 100) / 100,
      receita_referencia: Math.round(receitaRef * 100) / 100,
      oscilacao_pct_renda: Math.round(volatilidade * 1000) / 10,
      fator_amostra: Math.round(fatorAmostra * 100),
      fator_estabilidade: Math.round(fatorEstabilidade * 100),
    },
    insights,
    // S-P1: horizonte configurável
    horizonte_meses: mesesParam,
    // S-P2: projeção patrimonial com investimentos
    patrimonio: {
      investimentos_atual: Math.round(totalInvestimentos * 100) / 100,
      investimentos_investido: Math.round(totalInvestido * 100) / 100,
      // PJ5: o cache guarda a SELIC — rotulamos como tal (não como CDI, que é
      // outro número). O campo antigo é mantido por compatibilidade.
      taxa_base_nome: 'SELIC',
      taxa_base_anual: cdiAnual,
      rendimento_cdi_anual: cdiAnual,
      projecao_investimentos_12m: Math.round(totalInvestimentos * Math.pow(1 + cdiMensal, Math.min(12, mesesParam)) * 100) / 100
    },
    // Dados determinísticos
    dados_certos: {
      recorrencias_mensais: Math.round(recorrenciaMensal * 100) / 100,
      lembretes_estimados: Math.round(lembretesTotal * 100) / 100,
      meses_com_parcelas: Object.keys(parcelasMap).length,
      total_parcelas_futuras: Math.round(Object.values(parcelasMap).reduce((a, b) => a + b, 0) * 100) / 100
    },
    // Bloco 6.3: análise de viabilidade das metas
    metas_analise,
    resumo: {
      projecao_6m: Math.round((projecoes[5]?.valor || projecoes[projecoes.length - 1]?.valor || 0) * 100) / 100,
      projecao_12m: Math.round((projecoes[11]?.valor || projecoes[projecoes.length - 1]?.valor || 0) * 100) / 100,
      cenario_otimista_12m: Math.round((cenarioOtimista[11]?.valor || cenarioOtimista[cenarioOtimista.length - 1]?.valor || 0) * 100) / 100,
      cenario_pessimista_12m: Math.round((cenarioPessimista[11]?.valor || cenarioPessimista[cenarioPessimista.length - 1]?.valor || 0) * 100) / 100,
    }
  })
})

export default projecao
