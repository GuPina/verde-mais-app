/**
 * VerdeMais — envio de e-mail
 * ============================================================================
 * Só `fetch` contra a API HTTP do Resend: funciona no Cloudflare Workers e no
 * Node sem nenhuma dependência nova.
 *
 * Até aqui o app não enviava e-mail nenhum — o código de verificação voltava no
 * corpo da resposta da API (`_dev_otp`), o que tornava a verificação decorativa:
 * qualquer um lia o próprio código, e quem interceptasse a resposta também.
 *
 * Variáveis:
 *   RESEND_API_KEY   chave da API (sem ela, nada é enviado)
 *   EMAIL_REMETENTE  ex.: "VerdeMais <nao-responda@verdemais.app>"
 *
 * Sem chave configurada o OTP vai para o log do servidor e a função devolve
 * `enviado: false` — nunca para a resposta HTTP.
 */

export interface ResultadoEnvio {
  enviado: boolean
  motivo?: string
}

interface AmbienteEmail {
  RESEND_API_KEY?: string
  EMAIL_REMETENTE?: string
}

export async function enviarEmail(
  env: AmbienteEmail,
  para: string,
  assunto: string,
  html: string,
  texto: string,
): Promise<ResultadoEnvio> {
  const chave = env.RESEND_API_KEY
  if (!chave) {
    return { enviado: false, motivo: 'RESEND_API_KEY não configurada' }
  }

  const remetente = env.EMAIL_REMETENTE || 'VerdeMais <onboarding@resend.dev>'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: remetente, to: [para], subject: assunto, html, text: texto }),
    })
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '')
      return { enviado: false, motivo: `Resend HTTP ${res.status}: ${detalhe.slice(0, 200)}` }
    }
    return { enviado: true }
  } catch (e: any) {
    return { enviado: false, motivo: e?.message || 'falha de rede' }
  }
}

/** E-mail com o código de verificação de 6 dígitos. */
export async function enviarOTP(
  env: AmbienteEmail,
  para: string,
  nome: string,
  codigo: string,
): Promise<ResultadoEnvio> {
  const primeiroNome = (nome || '').trim().split(/\s+/)[0] || 'Olá'

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',system-ui,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#16213e;border:1px solid rgba(47,191,113,0.2);border-radius:20px;padding:36px;">
        <tr><td align="center" style="padding-bottom:8px;font-size:2rem;">💚</td></tr>
        <tr><td align="center" style="color:#2FBF71;font-size:1.3rem;font-weight:800;padding-bottom:24px;">VerdeMais</td></tr>
        <tr><td style="color:#e8e8f0;font-size:1rem;line-height:1.6;padding-bottom:8px;">${escaparHtml(primeiroNome)}, seu código de verificação é:</td></tr>
        <tr><td align="center" style="padding:24px 0;">
          <div style="display:inline-block;background:rgba(47,191,113,0.12);border:1px solid rgba(47,191,113,0.35);border-radius:14px;padding:18px 32px;color:#2FBF71;font-size:2.1rem;font-weight:800;letter-spacing:10px;">${codigo}</div>
        </td></tr>
        <tr><td style="color:#8a8a9e;font-size:0.85rem;line-height:1.6;">O código vale por 10 minutos. Se não foi você quem pediu, ignore este e-mail — nenhuma ação é necessária.</td></tr>
        <tr><td style="padding-top:28px;border-top:1px solid rgba(255,255,255,0.06);color:#55556a;font-size:0.75rem;">Este é um e-mail automático, não responda.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const texto = `${primeiroNome}, seu código de verificação do VerdeMais é: ${codigo}\n\n`
    + `O código vale por 10 minutos.\n`
    + `Se não foi você quem pediu, ignore este e-mail.`

  return enviarEmail(env, para, `${codigo} é o seu código VerdeMais`, html, texto)
}

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ))
}
