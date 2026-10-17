/**
 * Semeia o banco descartável: um usuário verificado e dez meses fechados.
 *
 * Os dez meses não são enfeite. Sem história, score e confiança saem ZERO nas
 * três telas, e o teste de coerência compararia 0 com 0 — passaria sem medir
 * nada. É o tipo de teste decorativo que dá sensação de cobertura e não pega
 * regressão nenhuma.
 */
import pg from 'pg'
import fs from 'node:fs'

const EMAIL = 'e2e@local.test'
const SENHA = 'e2e-' + Math.random().toString(36).slice(2) + '-Local1'

async function hash(senha) {
  const data = new TextEncoder().encode(senha)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)
  const hex = a => Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex(salt)}:${hex(new Uint8Array(bits))}`
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const colunas = (await c.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='users'`)).rows.map(r => r.column_name)
const extras = []
if (colunas.includes('email_verificado')) extras.push(['email_verificado', true])
if (colunas.includes('plano')) extras.push(['plano', 'pro'])

await c.query('DELETE FROM users WHERE email = $1', [EMAIL])
const campos = ['nome', 'email', 'senha', ...extras.map(e => e[0])]
const valores = ['E2E', EMAIL, await hash(SENHA), ...extras.map(e => e[1])]
const u = await c.query(
  `INSERT INTO users (${campos.join(',')}) VALUES (${campos.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`,
  valores)
const U = u.rows[0].id

const CATS = [['Moradia', 1800], ['Mercado', 1200], ['Combustível', 420], ['Saúde', 510],
              ['Alimentação', 380], ['Lazer', 260], ['Assinaturas', 95], ['Outros', 140]]
const hoje = new Date()
for (let k = 10; k >= 1; k--) {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - k, 15))
  const ym = d.toISOString().slice(0, 10)
  await c.query(`INSERT INTO receitas (user_id, descricao, valor, data, categoria, tipo)
                 VALUES ($1,'Salário',$2,$3,'Salário','receita')`, [U, 8200 + Math.round(Math.sin(k) * 180), ym])
  for (const [cat, base] of CATS) {
    const v = Math.round(base * (0.92 + ((k * 7 + cat.length) % 17) / 100) * 100) / 100
    await c.query(
      `INSERT INTO despesas (user_id, descricao, categoria, valor, data, vencimento, status, meio_pagamento, fixa_ou_variavel)
       VALUES ($1,$2,$3,$4,$5,$5,'pago','dinheiro','variavel')`, [U, `${cat} do mês`, cat, v, ym])
  }
}
await c.end()

// As credenciais vão para um arquivo lido pelo runner — nunca para a saída.
fs.writeFileSync('/tmp/vm-e2e-cred.env', `E2E_EMAIL=${EMAIL}\nE2E_SENHA=${SENHA}\n`)
console.log(`   usuário ${U} e 10 meses fechados semeados`)
