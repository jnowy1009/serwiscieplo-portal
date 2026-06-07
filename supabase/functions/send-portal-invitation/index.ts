import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Brak nagłówka autoryzacji')

    const supaAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Pobierz zalogowanego użytkownika (serwisanta)
    const supaAnon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userErr } = await supaAnon.auth.getUser()
    if (userErr || !user) throw new Error('Nieautoryzowany')

    // Sprawdź rolę serwisanta
    const { data: roleRow } = await supaAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (!roleRow || !['approved', 'admin', 'technician'].includes(roleRow.role)) {
      throw new Error('Brak uprawnień — tylko serwisanci mogą zapraszać klientów')
    }

    const { klient_id, email, klient_name } = await req.json()
    if (!klient_id || !email || !klient_name) throw new Error('Brakujące pola: klient_id, email, klient_name')

    // Usuń stare nieużyte zaproszenia dla tego klienta
    await supaAdmin
      .from('portal_invitations')
      .delete()
      .eq('klient_id', klient_id)
      .is('used_at', null)

    // Utwórz nowe zaproszenie
    const { data: inv, error: invErr } = await supaAdmin
      .from('portal_invitations')
      .insert({
        klient_id,
        technician_id: user.id,
        email,
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      })
      .select()
      .single()

    if (invErr || !inv) throw invErr ?? new Error('Błąd tworzenia zaproszenia')

    // Zaktualizuj portal_invited_at w klienci
    await supaAdmin
      .from('klienci')
      .update({ portal_invited_at: new Date().toISOString() })
      .eq('id', klient_id)

    // Wyślij email przez Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) throw new Error('RESEND_API_KEY nie jest ustawiony')

    const activationUrl = `https://portal.serwiscieplo.pl/?token=${inv.token}`

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SerwisCiepło <kontakt@serwiscieplo.pl>',
        to: [email],
        subject: 'Zaproszenie do Portalu SerwisCiepło',
        html: buildInvitationEmail(klient_name, activationUrl),
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
    console.error('[send-portal-invitation]', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildInvitationEmail(name: string, url: string): string {
  return `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:40px 20px;background:#f0ede8;font-family:-apple-system,'Segoe UI',Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto">
    <!-- Header -->
    <div style="background:#1c1917;border-radius:16px 16px 0 0;padding:24px;text-align:center">
      <div style="font-size:36px;margin-bottom:6px">🔥</div>
      <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.3px">SerwisCiepło</div>
      <div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:2px;text-transform:uppercase;letter-spacing:.06em">Portal Klienta</div>
    </div>
    <!-- Body -->
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.1)">
      <h2 style="margin:0 0 12px;font-size:18px;font-weight:800;color:#1c1917">
        Witaj, ${esc(name)}!
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:#78716c;line-height:1.65">
        Twój serwisant zaprasza Cię do <strong style="color:#1c1917">Portalu SerwisCiepło</strong>.
        Dzięki niemu możesz śledzić historię serwisów swojego kotła, sprawdzać datę
        następnego przeglądu i zgłaszać zapotrzebowanie na wizytę serwisową — wszystko
        bezpośrednio z telefonu.
      </p>
      <a href="${esc(url)}"
         style="display:block;text-align:center;background:linear-gradient(135deg,#c2410c,#ea580c);
                color:#fff;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:700;
                text-decoration:none;letter-spacing:-.2px">
        Aktywuj konto →
      </a>
      <p style="margin:18px 0 0;font-size:12px;color:#a8a29e;text-align:center;line-height:1.6">
        Link aktywacyjny jest ważny przez <strong>7 dni</strong>.<br>
        Jeśli nie spodziewałeś się tego zaproszenia, zignoruj tę wiadomość.
      </p>
    </div>
    <!-- Footer -->
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#a8a29e">
      © SerwisCiepło ·
      <a href="https://serwiscieplo.pl" style="color:#ea580c;text-decoration:none">serwiscieplo.pl</a>
    </p>
  </div>
</body>
</html>`
}
