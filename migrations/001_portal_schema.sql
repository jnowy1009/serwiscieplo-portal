-- ============================================================
-- Portal Klienta SerwisCiepło — migracja #001
-- Projekt Supabase: dzekzfxhqxiifuaesjum
-- INSTRUKCJA: Uruchom w Supabase SQL Editor
-- ============================================================

-- ── 1. Nowe kolumny w tabeli klienci ──────────────────────
ALTER TABLE klienci
  ADD COLUMN IF NOT EXISTS portal_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_invited_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_activated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS klienci_portal_user_id_idx ON klienci(portal_user_id);

-- ── 2. Tabela zaproszeń ────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_invitations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  klient_id     UUID        NOT NULL REFERENCES klienci(id) ON DELETE CASCADE,
  technician_id UUID        NOT NULL REFERENCES auth.users(id),
  email         TEXT        NOT NULL,
  token         TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE portal_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Technician manages own invitations" ON portal_invitations;
CREATE POLICY "Technician manages own invitations"
  ON portal_invitations FOR ALL TO authenticated
  USING (technician_id = auth.uid());

-- ── 3. Funkcja updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 4. Tabela zgłoszeń serwisowych ────────────────────────
CREATE TABLE IF NOT EXISTS service_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  klient_id          UUID        NOT NULL REFERENCES klienci(id) ON DELETE CASCADE,
  portal_user_id     UUID        NOT NULL REFERENCES auth.users(id),
  technician_id      UUID        REFERENCES auth.users(id),
  status             TEXT        NOT NULL DEFAULT 'new'
                                 CHECK (status IN ('new','in_progress','scheduled','completed','cancelled')),
  priority           TEXT        NOT NULL DEFAULT 'normal'
                                 CHECK (priority IN ('normal','urgent')),
  description        TEXT        NOT NULL,
  preferred_date     DATE,
  scheduled_date     TIMESTAMPTZ,
  scheduled_by       TEXT        CHECK (scheduled_by IN ('app','phone')),
  technician_note    TEXT,
  client_confirmed_at TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS update_service_requests_updated_at ON service_requests;
CREATE TRIGGER update_service_requests_updated_at
  BEFORE UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Client sees own requests"       ON service_requests;
DROP POLICY IF EXISTS "Technician sees clients requests" ON service_requests;

CREATE POLICY "Client sees own requests"
  ON service_requests FOR ALL TO authenticated
  USING (portal_user_id = auth.uid());

CREATE POLICY "Technician sees clients requests"
  ON service_requests FOR ALL TO authenticated
  USING (
    technician_id = auth.uid()
    OR klient_id IN (SELECT id FROM klienci WHERE user_id = auth.uid())
  );

-- ── 5. Rola portal_client w user_roles ────────────────────
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('pending','approved','admin','portal_client','technician'));

-- ── 6. RLS klienci — portal_client widzi swój rekord ──────
DROP POLICY IF EXISTS "Portal client sees own klienci" ON klienci;
CREATE POLICY "Portal client sees own klienci"
  ON klienci FOR SELECT TO authenticated
  USING (portal_user_id = auth.uid());

-- ── 7. RLS serwisy — portal_client widzi historię ─────────
DROP POLICY IF EXISTS "Portal client sees own serwisy" ON serwisy;
CREATE POLICY "Portal client sees own serwisy"
  ON serwisy FOR SELECT TO authenticated
  USING (
    klient_id IN (
      SELECT id FROM klienci WHERE portal_user_id = auth.uid()
    )
  );

-- ── KONIEC MIGRACJI ────────────────────────────────────────
-- Następne kroki po uruchomieniu SQL:
--   1. Wdróż Edge Functions (patrz README.md)
--   2. Ustaw sekrety: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY
--   3. Skonfiguruj Database Webhook (patrz supabase/webhooks.md)
