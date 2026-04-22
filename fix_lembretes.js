const fs = require('fs')
let c = fs.readFileSync('public/static/app.js', 'utf8')
const start = c.indexOf('  async carregarLembretes() {')
const endMark = '\n  },\n\n  modalLembrete('
const end = c.indexOf(endMark, start)

console.log('start:', start, 'end:', end)

const newBlock = `  async carregarLembretes() {
    try {
      // Recorrência: resetar status_mes de lembretes que já passaram do ciclo
      try { await this.api('POST', 'lembretes/reset-status') } catch(_e) {}

      const data = await this.api('GET', 'lembretes')
      const container = document.getElementById('lembretes-container')

      const tipoIcons = {
        conta:'📃', imposto:'🏛️', mensalidade:'📅', seguro:'🛡️',
        aluguel:'🏠', investimento:'📈', despesa:'💸', receita:'💵',
        saude:'🏥', educacao:'🎓', transporte:'🚗', revisao:'🔧',
        reuniao:'📋', tarefa:'✅', outros:'🔔'
      }
      const freqLabel = {
        semanal:'Semanal', quinzenal:'Quinzenal', mensal:'Mensal',
        bimestral:'Bimestral', trimestral:'Trimestral', semestral:'Semestral', anual:'Anual'
      }
      const grupos = {
        'Contas de Consumo': ['conta','aluguel','transporte','saude','educacao'],
        'Impostos': ['imposto'],
        'Mensalidades': ['mensalidade','seguro'],
        'Investimentos': ['investimento'],
        'Tarefas / Lembretes': ['reuniao','tarefa','revisao','outros','despesa','receita']
      }

      if (!data.lembretes || data.lembretes.length === 0) {
        container.innerHTML = '<div class="card" style="text-align:center;padding:60px 40px;"><div style="font-size:3rem;margin-bottom:16px;">🔔</div><h3 style="margin-bottom:8px;">Nenhum lembrete cadastrado</h3><p style="color:#666;margin-bottom:24px;">Adicione contas e lembretes para nunca perder um vencimento</p><button onclick="VM.modalLembrete()" class="btn-primary" style="width:auto;padding:10px 24px;"><i class="fas fa-plus"></i> Criar Lembrete</button></div>'
        return
      }

      const atrasados = data.lembretes.filter(l => l.atrasado && l.status_mes === 'aguardando')
      const urgentes  = data.lembretes.filter(l => l.urgente && !l.atrasado)
      const demais    = data.lembretes.filter(l => !l.urgente && !l.atrasado)

      const renderLembrete = (l, destacar) => {
        const dias = l.dias_para_vencer
        let diasStr = ''
        if (l.atrasado) {
          diasStr = '<span style="background:rgba(255,80,80,0.2);color:#ff6b6b;border-radius:6px;padding:2px 7px;font-size:0.68rem;font-weight:700;margin-left:4px;">⛔ Atrasado ' + Math.abs(dias||0) + 'd</span>'
        } else if (dias !== null && dias !== undefined) {
          const bg = dias <= 3 ? '255,107,107' : '255,196,0'
          const cor = dias <= 3 ? '#ff6b6b' : '#ffc400'
          diasStr = '<span style="background:rgba(' + bg + ',0.12);color:' + cor + ';border-radius:6px;padding:2px 7px;font-size:0.68rem;font-weight:700;margin-left:4px;">' + (dias === 0 ? 'Hoje!' : dias + 'd') + '</span>'
        }
        const bord = l.atrasado ? 'rgba(255,107,107,0.2)' : destacar ? 'rgba(255,196,0,0.15)' : 'rgba(255,255,255,0.04)'
        const bg   = l.atrasado ? 'rgba(255,107,107,0.04)' : destacar ? 'rgba(255,196,0,0.03)' : 'rgba(255,255,255,0.02)'
        const lJson = JSON.stringify(l).replace(/"/g, '&quot;')
        const pagoBtn = l.status_mes === 'aguardando'
          ? '<button onclick="VM.pagarLembreteRapido(' + l.id + ')" title="Marcar como pago" style="background:rgba(47,191,113,0.15);border:1px solid rgba(47,191,113,0.3);color:#2FBF71;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.7rem;font-weight:600;"><i class="fas fa-check"></i> Pago</button>'
          : '<span class="badge badge-green" style="font-size:0.65rem;">' + l.status_mes + '</span>'
        return '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:' + bg + ';border-radius:12px;border:1px solid ' + bord + ';">'
          + '<div style="width:42px;height:42px;background:rgba(47,191,113,0.1);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">' + (tipoIcons[l.tipo] || '🔔') + '</div>'
          + '<div style="flex:1;min-width:0;">'
          +   '<div style="font-weight:600;font-size:0.88rem;display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' + l.titulo + diasStr + '</div>'
          +   '<div style="font-size:0.72rem;color:#666;margin-top:2px;">' + (freqLabel[l.frequencia] || 'Mensal') + ' • Dia ' + (l.dia_vencimento || '-') + (l.proximo_vencimento ? ' • Próx: ' + VM.formatDate(l.proximo_vencimento) : '') + '</div>'
          + '</div>'
          + '<div style="text-align:right;flex-shrink:0;">'
          +   '<div style="font-weight:700;font-size:0.9rem;">' + VM.formatMoney(l.valor_estimado) + '</div>'
          +   '<div style="margin-top:4px;display:flex;gap:4px;justify-content:flex-end;align-items:center;">'
          +     pagoBtn
          +     '<button onclick="VM.modalConverterLembrete(' + lJson + ')" title="Converter em Despesa" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#888;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.7rem;"><i class="fas fa-exchange-alt"></i></button>'
          +     '<button onclick="VM.modalLembrete(' + lJson + ')" class="btn-success" style="padding:4px 8px;font-size:0.7rem;"><i class="fas fa-edit"></i></button>'
          +     '<button onclick="VM.deleteLembrete(' + l.id + ')" class="btn-danger" style="padding:4px 8px;font-size:0.7rem;"><i class="fas fa-trash"></i></button>'
          +   '</div>'
          + '</div></div>'
      }

      const gruposHtml = Object.entries(grupos).map(([grupo, tipos]) => {
        const itens = demais.filter(l => tipos.includes(l.tipo))
        if (!itens.length) return ''
        return '<div style="margin-bottom:16px;"><div style="font-size:0.75rem;font-weight:600;color:#666;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">' + grupo + ' (' + itens.length + ')</div><div style="display:flex;flex-direction:column;gap:8px;">' + itens.map(l => renderLembrete(l, false)).join('') + '</div></div>'
      }).join('')

      const totalMensal = this.formatMoney(data.lembretes.filter(l => l.ativo).reduce((s, l) => s + (l.valor_estimado || 0), 0))
      const aguardando  = data.lembretes.filter(l => l.status_mes === 'aguardando').length

      let html = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">'
        + '<div class="stat-card" style="flex:1;min-width:120px;text-align:center;padding:12px;"><div style="font-size:1.4rem;font-weight:800;color:#2FBF71;">' + aguardando + '</div><div style="font-size:0.7rem;color:#666;">Aguardando</div></div>'
        + '<div class="stat-card" style="flex:1;min-width:120px;text-align:center;padding:12px;"><div style="font-size:1.4rem;font-weight:800;color:#ff6b6b;">' + atrasados.length + '</div><div style="font-size:0.7rem;color:#666;">Atrasados</div></div>'
        + '<div class="stat-card" style="flex:1;min-width:120px;text-align:center;padding:12px;"><div style="font-size:1.4rem;font-weight:800;color:#ffc400;">' + urgentes.length + '</div><div style="font-size:0.7rem;color:#666;">Vencendo em breve</div></div>'
        + '<div class="stat-card" style="flex:1;min-width:120px;text-align:center;padding:12px;"><div style="font-size:1.4rem;font-weight:800;">' + totalMensal + '</div><div style="font-size:0.7rem;color:#666;">Total mensal</div></div>'
        + '</div>'

      if (atrasados.length) {
        html += '<div class="card" style="border-left:4px solid #ff6b6b;margin-bottom:16px;"><div style="font-size:0.95rem;font-weight:700;color:#ff6b6b;margin-bottom:12px;">⛔ Atrasados — Ação necessária (' + atrasados.length + ')</div><div style="display:flex;flex-direction:column;gap:8px;">' + atrasados.map(l => renderLembrete(l, true)).join('') + '</div></div>'
      }
      if (urgentes.length) {
        html += '<div class="card" style="border-left:4px solid #ffc400;margin-bottom:16px;"><div style="font-size:0.95rem;font-weight:700;color:#ffc400;margin-bottom:12px;">⚠️ Vencendo em breve (' + urgentes.length + ')</div><div style="display:flex;flex-direction:column;gap:8px;">' + urgentes.map(l => renderLembrete(l, true)).join('') + '</div></div>'
      }

      html += '<div class="card"><div style="font-weight:700;margin-bottom:16px;">📋 Todos os Lembretes</div>'
        + (gruposHtml || '<div style="display:flex;flex-direction:column;gap:8px;">' + demais.map(l => renderLembrete(l, false)).join('') + '</div>')
        + '</div>'

      container.innerHTML = html
    } catch (e) {
      this.toast('Erro ao carregar lembretes', 'error')
    }
  }`

fs.writeFileSync('public/static/app.js', c.substring(0, start) + newBlock + c.substring(end))
console.log('✅ carregarLembretes reescrito. Tamanho novo:', newBlock.length)
