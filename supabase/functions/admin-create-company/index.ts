import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// Tworzy konto firmowe. Wywoływana przez ADMINA z panelu technika.
// Zwraca kody błędów ASCII (UI mapuje na polskie komunikaty).
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Zweryfikuj, że wołający to admin
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)
    const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(jwt)
    if (callerErr || !caller) return json({ error: 'unauthorized' }, 401)
    const { data: callerRole } = await admin
      .from('user_roles').select('role').eq('user_id', caller.id).single()
    if (callerRole?.role !== 'admin') return json({ error: 'forbidden' }, 403)

    // 2. Walidacja danych
    const { nazwa, email, password, nip, telefon, adres } = await req.json()
    if (!nazwa || !email || !password) return json({ error: 'missing_fields' }, 400)
    if (String(password).length < 8) return json({ error: 'weak_password' }, 400)

    // 3. Utwórz konto auth firmy (account_type=company → trigger nada rolę 'company')
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { account_type: 'company', nazwa },
    })
    if (createErr || !created.user) {
      const msg = createErr?.message || ''
      return json({ error: /already registered|exists/i.test(msg) ? 'email_taken' : 'create_failed', detail: msg }, 400)
    }
    const uid = created.user.id

    // 4. Zabezpieczenie roli (gdyby trigger nie zadziałał)
    await admin.from('user_roles').upsert(
      { user_id: uid, role: 'company', email, full_name: nazwa },
      { onConflict: 'user_id' },
    )

    // 5. Wstaw rekord firmy
    const { data: firma, error: firmaErr } = await admin
      .from('firmy')
      .insert({ owner_user_id: uid, nazwa, nip: nip || null, email, telefon: telefon || null, adres: adres || null })
      .select().single()
    if (firmaErr) return json({ error: 'firma_insert_failed', detail: firmaErr.message }, 400)

    return json({ success: true, firma_id: firma.id, email })
  } catch (err) {
    console.error('[admin-create-company]', err)
    return json({ error: 'server_error', detail: err instanceof Error ? err.message : String(err) }, 500)
  }
})
