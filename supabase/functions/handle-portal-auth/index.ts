import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { token, password } = await req.json()
    if (!token || !password) throw new Error('Brakujące pola: token, password')
    if (password.length < 8) throw new Error('Hasło musi mieć co najmniej 8 znaków')

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Znajdź ważne zaproszenie
    const { data: inv, error: invErr } = await supa
      .from('portal_invitations')
      .select('*')
      .eq('token', token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (invErr || !inv) {
      return new Response(
        JSON.stringify({ error: 'Token nieważny lub wygasł. Poproś serwisanta o nowe zaproszenie.' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // Sprawdź czy użytkownik z tym emailem już istnieje
    const { data: { users: allUsers } } = await supa.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existing = allUsers.find((u) => u.email === inv.email)

    let userId: string

    if (existing) {
      // Zaktualizuj hasło istniejącego użytkownika
      const { error: upErr } = await supa.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      })
      if (upErr) throw upErr
      userId = existing.id
    } else {
      // Utwórz nowego użytkownika.
      // account_type='portal_client' → trigger handle_new_user nada od razu rolę
      // 'portal_client' (zamiast 'pending'), więc NIE odpala powiadomienia serwisanckiego.
      const { data: created, error: createErr } = await supa.auth.admin.createUser({
        email: inv.email,
        password,
        email_confirm: true,
        user_metadata: { account_type: 'portal_client' },
      })
      if (createErr || !created.user) throw createErr ?? new Error('Błąd tworzenia konta')
      userId = created.user.id
    }

    // Dodaj / zaktualizuj rolę portal_client (zabezpieczenie — gdyby trigger nie zadziałał).
    const { error: roleErr } = await supa.from('user_roles').upsert(
      { user_id: userId, role: 'portal_client' },
      { onConflict: 'user_id' }
    )
    if (roleErr) console.error('[handle-portal-auth] user_roles upsert:', roleErr)

    // Powiąż z rekordem klienta
    const { error: linkErr } = await supa
      .from('klienci')
      .update({
        portal_user_id: userId,
        portal_activated_at: new Date().toISOString(),
      })
      .eq('id', inv.klient_id)

    if (linkErr) throw linkErr

    // Oznacz zaproszenie jako użyte
    await supa
      .from('portal_invitations')
      .update({ used_at: new Date().toISOString() })
      .eq('id', inv.id)

    return new Response(
      JSON.stringify({ success: true, email: inv.email }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[handle-portal-auth]', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Błąd serwera' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
