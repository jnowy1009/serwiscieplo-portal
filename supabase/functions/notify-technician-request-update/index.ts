// ─────────────────────────────────────────────────────────────────────────
// Edge Function: notify-technician-request-update
// Wywoływana przez PORTAL gdy klient reaguje na propozycję terminu:
//   action='confirmed'  → klient potwierdził termin  → push do technika
//   action='reschedule' → klient prosi o inny termin → push z wiadomością klienta
// Push leci na urządzenia technika (push_subscriptions). VAPID — te same sekrety co send-reminders.
//
// UWAGA: wpis w kalendarzu technika tworzy TRIGGER DB (sync_visit_to_calendar)
// w tej samej transakcji co potwierdzenie — niezawodnie, niezależnie od tej
// funkcji. Tu robimy WYŁĄCZNIE push, by powiadomienie szło jak najszybciej
// (bez czekania na zapytania do bazy o kalendarz — to była przyczyna opóźnień).
// ─────────────────────────────────────────────────────────────────────────
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:kontakt@serwiscieplo.pl'
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

async function sendPushToTechnician(supa: any, techId: string, payload: unknown): Promise<number> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) { console.warn('[push] brak VAPID'); return 0 }
  const { data: subs } = await supa
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', techId)
  if (!subs?.length) return 0
  let sent = 0
  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      )
      sent++
    } catch (e: any) {
      const code = e?.statusCode
      if (code === 404 || code === 410) await supa.from('push_subscriptions').delete().eq('id', s.id)
      else console.error('[push] błąd', code, e?.body ?? e?.message)
    }
  }))
  return sent
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { request_id, action, message } = await req.json()
    if (!request_id || !action) throw new Error('Brak request_id lub action')

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: sr } = await supa
      .from('service_requests')
      .select('id, klient_id, technician_id, scheduled_date, description')
      .eq('id', request_id)
      .single()
    if (!sr) throw new Error('Zgłoszenie nie znalezione')

    const { data: klient } = await supa
      .from('klienci')
      .select('imie_nazwisko, user_id')
      .eq('id', sr.klient_id)
      .single()
    if (!klient) throw new Error('Klient nie znaleziony')

    const techId = sr.technician_id ?? klient.user_id
    if (!techId) throw new Error('Brak przypisanego technika')

    const url = `./?klient=${sr.klient_id}&req=${sr.id}`
    let pushSent = 0

    if (action === 'confirmed') {
      const dateLabel = sr.scheduled_date
        ? new Date(sr.scheduled_date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
        : ''
      pushSent = await sendPushToTechnician(supa, techId, {
        title: '✅ Klient potwierdził wizytę',
        body: `${klient.imie_nazwisko}${dateLabel ? ' — ' + dateLabel : ''}`,
        tag: `sc-confirm-${sr.id}`,
        url,
        requireInteraction: true,
      })
    } else if (action === 'reschedule') {
      pushSent = await sendPushToTechnician(supa, techId, {
        title: '🔄 Klient prosi o inny termin',
        body: `${klient.imie_nazwisko}${message ? ': ' + String(message).slice(0, 120) : ''}`,
        tag: `sc-reschedule-${sr.id}`,
        url,
        requireInteraction: true,
      })
    } else {
      throw new Error('Nieznana akcja: ' + action)
    }

    return new Response(JSON.stringify({ success: true, pushSent }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[notify-technician-request-update]', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
