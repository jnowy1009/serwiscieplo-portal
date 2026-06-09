-- ============================================================
-- Zadanie E — rozbudowa zleceń firmowych (migracja #003)
-- Projekt Supabase: dzekzfxhqxiifuaesjum
-- INSTRUKCJA: uruchom w Supabase SQL Editor (lub Management API)
-- ============================================================
-- 1) Firma zlecając podaje DANE KLIENTA (firma nie ma dostępu do tabeli
--    klienci serwisanta, więc dane wpisuje ad-hoc).
-- 2) Serwisant widzi, do jakich firm należy (badge w panelu) — get_my_firmy.
-- 3) Powiązanie zlecenie ↔ wpis w kalendarzu technika (zlecenie_id) —
--    żeby „Dodaj do kalendarza" nie duplikowało wpisów.

-- ── 1. Dane klienta na zleceniu ───────────────────────────────
alter table public.zlecenia add column if not exists klient_imie     text;
alter table public.zlecenia add column if not exists klient_adres    text;
alter table public.zlecenia add column if not exists klient_telefon  text;
alter table public.zlecenia add column if not exists klient_email    text;

-- ── 2. Serwisant: do jakich firm należy (status 'active') ─────
-- RLS na firmy widzi tylko właściciel, więc serwisant potrzebuje RPC (definer).
create or replace function public.get_my_firmy()
returns table (firma_id uuid, nazwa text, status text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select f.id, f.nazwa, fs.status
    from firma_serwisanci fs
    join firmy f on f.id = fs.firma_id
    where fs.serwisant_user_id = auth.uid() and fs.status = 'active'
    order by f.nazwa;
end; $$;
grant execute on function public.get_my_firmy() to authenticated;

-- ── 3. Powiązanie zlecenia z wpisem w kalendarzu technika ─────
alter table public.wydarzenia add column if not exists zlecenie_id uuid;
create index if not exists idx_wydarzenia_zlecenie
  on public.wydarzenia(zlecenie_id) where zlecenie_id is not null;

-- ── KONIEC MIGRACJI 003 ───────────────────────────────────────
