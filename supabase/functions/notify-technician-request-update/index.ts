// ─────────────────────────────────────────────────────────────────────────
// Edge Function: notify-technician-request-update
// Wywoływana przez PORTAL gdy klient reaguje na propozycję terminu:
//   action='confirmed'  → klient potwierdził termin  → push + auto-wpis w kalendarzu technika
//   action='reschedule' → klient prosi o inny termin → push z wiadomością klienta
// Push leci na urządzenia technika (push_subscriptions). VAPID — te same sekrety co send-reminders.
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

// Tworzy wpis w kalendarzu technika dla potwierdzonej wizyty (bez duplikatów).
async function addCalendarEvent(supa: any, techId: string, sr: any, klientName: string): Promise<boolean> {
  if (!sr.scheduled_date) return false
  const d = new Date(sr.scheduled_date)
  const data = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })          // YYYY-MM-DD
  const godzina = d.toLocaleTimeString('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }) // HH:MM
  // Guard: nie duplikuj jeśli wizyta tego klienta na ten dzień już jest w kalendarzu.
  const { data: existing } = await supa
    .from('wydarzenia')
    .select('id')
    .eq('user_id', techId)
    .eq('klient_id', sr.klient_id)
    .eq('data', data)
    .limit(1)
  if (existing?.length) return false
  const { error } = await supa.from('wydarzenia').insert({
    user_id: techId,
    klient_id: sr.klient_id,
    tytul: `Wizyta: ${klientName}`,
    data,
    godzina,
    typ: 'wizyta',
    opis: sr.description ? `Zgłoszenie: ${String(sr.description).slice(0, 200)}` : null,
  })
  if (error) { console.error('[kalendarz]', error.message); return false }
  return true
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
    let calendarAdded = false

    if (action === 'confirmed') {
      const dateLabel = sr.scheduled_date
        ? new Date(sr.scheduled_date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
        : ''
      calendarAdded = await addCalendarEvent(supa, techId, sr, klient.imie_nazwisko)
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

    return new Response(JSON.stringify({ success: true, pushSent, calendarAdded }), {
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
