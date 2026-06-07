import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Database webhook wysyła cały payload z rekordem
    const payload = await req.json()
    const sr = payload.record // service_request record

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Pobierz dane klienta i serwisanta
    const { data: klient } = await supa
      .from('klienci')
      .select('imie_nazwisko, adres, kociol, user_id')
      .eq('id', sr.klient_id)
      .single()

    if (!klient) throw new Error('Klient nie znaleziony')

    // Pobierz email serwisanta — najpierw z profilu serwisanci, fallback na auth email
    const techId = sr.technician_id ?? klient.user_id
    const { data: serwisant } = await supa
      .from('serwisanci')
      .select('email')
      .eq('user_id', techId)
      .maybeSingle()

    let techEmail = serwisant?.email?.trim() || null
    if (!techEmail) {
      const { data: { user: tech } } = await supa.auth.admin.getUserById(techId)
      techEmail = tech?.email || null
    }
    if (!techEmail) throw new Error('Email serwisanta nie znaleziony')

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) throw new Error('RESEND_API_KEY nie jest ustawiony')

    const priorityLabel = sr.priority === 'urgent' ? '🔴 PILNE' : '⚪ Zwykłe'
    const preferredDateLabel = sr.preferred_date
      ? new Date(sr.preferred_date).toLocaleDateString('pl-PL', {
          day: 'numeric', month: 'long', year: 'numeric'
        })
      : 'Nie podano'

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Portal SerwisCiepło <kontakt@serwiscieplo.pl>',
        to: [techEmail],
        subject: `Nowe zgłoszenie od ${klient.imie_nazwisko}`,
        html: buildNotifEmail(klient, sr, priorityLabel, preferredDateLabel),
      }),
    })

    if (!emailRes.ok) {
      const txt = await emailRes.text()
      throw new Error(`Resend error (${emailRes.status}): ${txt}`)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[notify-technician-new-request]', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildNotifEmail(
  klient: { imie_nazwisko: string; adres: string; kociol?: string },
  sr: { description: string; priority: string; preferred_date?: string },
  priorityLabel: string,
  preferredDateLabel: string
): string {
  return `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:40px 20px;background:#f0ede8;font-family:-apple-system,'Segoe UI',Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto">
    <div style="background:#1c1917;border-radius:16px 16px 0 0;padding:20px 24px;display:flex;align-items:center;gap:10px">
      <span style="font-size:26px">🔥</span>
      <div>
        <div style="font-size:16px;font-weight:800;color:#fff">SerwisCiepło</div>
        <div style="font-size:11px;color:rgba(255,255,255,.4)">Portal Klienta</div>
      </div>
    </div>
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.1)">
      <div style="display:inline-block;background:${sr.priority === 'urgent' ? '#fef2f2' : '#f0fdf4'};
                  color:${sr.priority === 'urgent' ? '#b91c1c' : '#15803d'};
                  border:1px solid ${sr.priority === 'urgent' ? '#fecaca' : '#bbf7d0'};
                  padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700;margin-bottom:16px">
        ${esc(priorityLabel)}
      </div>
      <h2 style="margin:0 0 4px;font-size:18px;font-weight:800;color:#1c1917">
        Nowe zgłoszenie serwisowe
      </h2>
      <p style="margin:0 0 20px;font-size:13px;color:#78716c">od klienta: <strong>${esc(klient.imie_nazwisko)}</strong></p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px">
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f0ede8;color:#78716c;width:40%">Klient</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0ede8;font-weight:600">${esc(klient.imie_nazwisko)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f0ede8;color:#78716c">Adres</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0ede8">${esc(klient.adres || '—')}</td>
        </tr>
        ${klient.kociol ? `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #f0ede8;color:#78716c">Kocioł</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0ede8">${esc(klient.kociol)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:8px 0;color:#78716c">Preferowana data</td>
          <td style="padding:8px 0">${esc(preferredDateLabel)}</td>
        </tr>
      </table>

      <div style="background:#f7f4f0;border-radius:8px;padding:14px;font-size:14px;line-height:1.65;color:#1c1917;border-left:3px solid #ea580c">
        ${esc(sr.description)}
      </div>

      <p style="margin:20px 0 0;font-size:12px;color:#a8a29e;text-align:center">
        Zaloguj się do aplikacji SerwisCiepło, aby zarządzać tym zgłoszeniem i odpowiedzieć klientowi.
      </p>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#a8a29e">
      © SerwisCiepło · <a href="https://serwiscieplo.pl" style="color:#ea580c;text-decoration:none">serwiscieplo.pl</a>
    </p>
  </div>
</body>
</html>`
}
