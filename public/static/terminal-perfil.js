(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const EMPREGO = [['clt', 'CLT'], ['pj', 'PJ'], ['autonomo', 'Autônomo'], ['servidor', 'Servidor público'], ['empresario', 'Empresário'], ['aposentado', 'Aposentado'], ['estudante', 'Estudante'], ['desempregado', 'Desempregado']]
  const CIVIL = [['solteiro', 'Solteiro(a)'], ['casado', 'Casado(a)'], ['divorciado', 'Divorciado(a)'], ['viuvo', 'Viúvo(a)'], ['uniao_estavel', 'União estável']]
  const PERFIL = [['conservador', 'Conservador'], ['moderado', 'Moderado'], ['arrojado', 'Arrojado']]

  window.VMTerminalPerfil = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await vm.api('GET', 'perfil')
        this._d = d.perfil || d.usuario || d
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar o perfil</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalPerfil.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },
    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },
    _sel(id, opts, val) { return `<select id="${id}" style="${this._st()}"><option value="">—</option>${opts.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d, s = this._st()
      const iniciais = String(d.nome || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
      const rendaTotal = (Number(d.salario_mensal || d.renda_mensal) || 0) + (Number(d.outras_rendas) || 0)

      content.innerHTML = this._shell(`
        <section class="pf-hero">
          <div class="pf-avatar" style="background:${esc(d.avatar_color || 'var(--terminal-primary-soft)')}">${esc(iniciais)}</div>
          <div class="pf-hero__main">
            <h2>${esc(d.nome || 'Sem nome')}</h2>
            <p>${esc(d.email || '')}</p>
            <div class="pf-tags"><span class="fe-badge">Plano ${esc(d.plano || 'free')}</span>${d.perfil_investidor ? `<span class="an-badge an-badge--ok">${esc(d.perfil_investidor)}</span>` : ''}${d.perfil_completo ? '<span class="an-badge an-badge--ok">perfil completo</span>' : '<span class="an-badge an-badge--warn">perfil incompleto</span>'}</div>
          </div>
          <div class="pf-hero__renda"><span class="td-eyebrow">Renda mensal</span><div class="pf-renda">${money(rendaTotal)}</div></div>
        </section>

        <article class="td-panel" style="margin-top:18px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Seus dados</span><h2>Informações pessoais</h2></div></div>
          <div class="pf-grid">
            <div>${this._lab('Nome')}<input id="pf-nome" style="${s}" value="${esc(d.nome || '')}"></div>
            <div>${this._lab('Profissão')}<input id="pf-prof" style="${s}" value="${esc(d.profissao || '')}"></div>
            <div>${this._lab('Situação de emprego')}${this._sel('pf-emprego', EMPREGO, d.situacao_emprego)}</div>
            <div>${this._lab('Perfil de investidor')}${this._sel('pf-invest', PERFIL, d.perfil_investidor)}</div>
            <div>${this._lab('Salário mensal (R$)')}<input id="pf-salario" type="number" min="0" step="0.01" style="${s}" value="${Number(d.salario_mensal || d.renda_mensal) || ''}"></div>
            <div>${this._lab('Outras rendas (R$)')}<input id="pf-outras" type="number" min="0" step="0.01" style="${s}" value="${Number(d.outras_rendas) || ''}"></div>
            <div>${this._lab('Dependentes')}<input id="pf-dep" type="number" min="0" max="30" style="${s}" value="${Number(d.dependentes) || 0}"></div>
            <div>${this._lab('Estado civil')}${this._sel('pf-civil', CIVIL, d.estado_civil)}</div>
            <div>${this._lab('Cidade')}<input id="pf-cidade" style="${s}" value="${esc(d.cidade || '')}"></div>
            <div>${this._lab('Estado (UF)')}<input id="pf-estado" maxlength="2" style="${s}" value="${esc(d.estado || '')}"></div>
          </div>
          <div style="margin-top:16px"><button class="td-button td-button--primary" onclick="VMTerminalPerfil.salvar()"><i class="fas fa-check"></i> Salvar alterações</button></div>
        </article>

        <div class="rg-cols">
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Segurança</span><h2>Alterar senha</h2></div></div>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div>${this._lab('Senha atual')}<input id="pf-sa" type="password" style="${s}" autocomplete="current-password"></div>
              <div>${this._lab('Nova senha (mín. 6)')}<input id="pf-sn" type="password" style="${s}" autocomplete="new-password"></div>
              <button class="td-button" style="align-self:flex-start" onclick="VMTerminalPerfil.trocarSenha()"><i class="fas fa-lock"></i> Trocar senha</button>
            </div>
          </article>
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Segurança</span><h2>Alterar e-mail</h2></div></div>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div>${this._lab('Novo e-mail')}<input id="pf-ne" type="email" style="${s}" value="${esc(d.email || '')}"></div>
              <div>${this._lab('Sua senha (confirmação)')}<input id="pf-ep" type="password" style="${s}" autocomplete="current-password"></div>
              <button class="td-button" style="align-self:flex-start" onclick="VMTerminalPerfil.trocarEmail()"><i class="fas fa-envelope"></i> Atualizar e-mail</button>
            </div>
          </article>
        </div>
      `)
    },

    async salvar() {
      const vm = this._vm, g = i => document.getElementById(i)
      const payload = {
        nome: g('pf-nome')?.value?.trim(),
        profissao: g('pf-prof')?.value?.trim() || null,
        situacao_emprego: g('pf-emprego')?.value || null,
        perfil_investidor: g('pf-invest')?.value || null,
        salario_mensal: parseFloat(g('pf-salario')?.value) || 0,
        outras_rendas: parseFloat(g('pf-outras')?.value) || 0,
        dependentes: parseInt(g('pf-dep')?.value) || 0,
        estado_civil: g('pf-civil')?.value || null,
        cidade: g('pf-cidade')?.value?.trim() || null,
        estado: (g('pf-estado')?.value || '').toUpperCase() || null,
      }
      const r = await vm.api('PUT', 'perfil', payload).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Perfil atualizado.', 'success'); this._d = { ...this._d, ...payload }; this.render(vm) }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },
    async trocarSenha() {
      const vm = this._vm, g = i => document.getElementById(i)
      const senha_atual = g('pf-sa')?.value, nova_senha = g('pf-sn')?.value
      if (!senha_atual || !nova_senha) return vm.toast('Preencha as duas senhas.', 'error')
      if (nova_senha.length < 6) return vm.toast('A nova senha precisa de ao menos 6 caracteres.', 'error')
      const r = await vm.api('PATCH', 'perfil/senha', { senha_atual, nova_senha }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Senha alterada.', 'success'); if (g('pf-sa')) g('pf-sa').value = ''; if (g('pf-sn')) g('pf-sn').value = '' }
      else vm.toast(r?.error || 'Erro ao trocar senha.', 'error')
    },
    async trocarEmail() {
      const vm = this._vm, g = i => document.getElementById(i)
      const email = g('pf-ne')?.value?.trim(), senha = g('pf-ep')?.value
      if (!email || !senha) return vm.toast('Informe o novo e-mail e sua senha.', 'error')
      const r = await vm.api('PATCH', 'perfil/email', { email, senha }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('E-mail atualizado.', 'success'); this._d = { ...this._d, email }; if (g('pf-ep')) g('pf-ep').value = ''; this.render(vm) }
      else vm.toast(r?.error || 'Erro ao atualizar e-mail.', 'error')
    },

    _shell(inner) {
      return `<div class="td-dashboard pf">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Sua conta</span>
            <h1>Meu perfil. <em>Quem você é para o VerdeMais.</em></h1>
            <p>Seus dados alimentam o diagnóstico, a regra 50/30/20 e as projeções — mantê-los certos deixa tudo mais preciso.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
