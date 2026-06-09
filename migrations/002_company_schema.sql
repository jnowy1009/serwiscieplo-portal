-- ============================================================
-- Zadanie 3 — Panel firmowy (migracja #002)
-- Projekt Supabase: dzekzfxhqxiifuaesjum
-- INSTRUKCJA: uruchom w Supabase SQL Editor
-- ============================================================
-- Model: admin zakłada konto firmy (edge admin-create-company) →
--        firma loguje się w portalu i zaprasza serwisantów po e-mailu →
--        serwisant akceptuje w panelu → firma tworzy i przypisuje zlecenia.
-- RLS gwarantuje: firma widzi TYLKO swoich serwisantów i swoje zlecenia.
-- Konwencja: RPC zwracają kody błędów ASCII (UI mapuje na polskie komunikaty).

-- ── 1. Rola 'company' w user_roles ────────────────────────────
alter table user_roles drop constraint if exists user_roles_role_check;
alter table user_roles add constraint user_roles_role_check
  check (role in ('pending','approved','admin','portal_client','technician','company'));

-- ── 2. Tabela firm ────────────────────────────────────────────
create table if not exists firmy (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  nazwa         text not null,
  nip           text,
  email         text,
  telefon       text,
  adres         text,
  blocked       boolean not null default false,
  created_at    timestamptz default now()
);
create index if not exists firmy_owner_idx on firmy(owner_user_id);

alter table firmy enable row level security;
drop policy if exists "Firma owner manages own" on firmy;
create policy "Firma owner manages own" on firmy for all to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- ── 3. Członkostwo serwisant ↔ firma ──────────────────────────
create table if not exists firma_serwisanci (
  id                uuid primary key default gen_random_uuid(),
  firma_id          uuid not null references firmy(id) on delete cascade,
  serwisant_user_id uuid not null references auth.users(id) on delete cascade,
  status            text not null default 'invited' check (status in ('invited','active','removed')),
  created_at        timestamptz default now(),
  unique (firma_id, serwisant_user_id)
);
create index if not exists firma_serw_firma_idx on firma_serwisanci(firma_id);
create index if not exists firma_serw_user_idx  on firma_serwisanci(serwisant_user_id);

alter table firma_serwisanci enable row level security;
drop policy if exists "Firma manages members" on firma_serwisanci;
create policy "Firma manages members" on firma_serwisanci for all to authenticated
  using (firma_id in (select id from firmy where owner_user_id = auth.uid()))
  with check (firma_id in (select id from firmy where owner_user_id = auth.uid()));
drop policy if exists "Serwisant sees own membership" on firma_serwisanci;
create policy "Serwisant sees own membership" on firma_serwisanci for select to authenticated
  using (serwisant_user_id = auth.uid());
drop policy if exists "Serwisant updates own membership" on firma_serwisanci;
create policy "Serwisant updates own membership" on firma_serwisanci for update to authenticated
  using (serwisant_user_id = auth.uid()) with check (serwisant_user_id = auth.uid());

-- ── 4. Zlecenia firmowe ───────────────────────────────────────
create table if not exists zlecenia (
  id                uuid primary key default gen_random_uuid(),
  firma_id          uuid not null references firmy(id) on delete cascade,
  serwisant_user_id uuid references auth.users(id),
  klient_id         uuid references klienci(id),
  tytul             text not null,
  opis              text,
  status            text not null default 'new'    check (status in ('new','assigned','in_progress','completed','cancelled')),
  priorytet         text not null default 'normal' check (priorytet in ('normal','urgent')),
  scheduled_date    timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists zlecenia_firma_idx on zlecenia(firma_id);
create index if not exists zlecenia_serw_idx  on zlecenia(serwisant_user_id);

drop trigger if exists update_zlecenia_updated_at on zlecenia;
create trigger update_zlecenia_updated_at before update on zlecenia
  for each row execute function update_updated_at_column();

alter table zlecenia enable row level security;
drop policy if exists "Firma manages own zlecenia" on zlecenia;
create policy "Firma manages own zlecenia" on zlecenia for all to authenticated
  using (firma_id in (select id from firmy where owner_user_id = auth.uid()))
  with check (firma_id in (select id from firmy where owner_user_id = auth.uid()));
drop policy if exists "Serwisant sees assigned zlecenia" on zlecenia;
create policy "Serwisant sees assigned zlecenia" on zlecenia for select to authenticated
  using (serwisant_user_id = auth.uid());
drop policy if exists "Serwisant updates assigned zlecenia" on zlecenia;
create policy "Serwisant updates assigned zlecenia" on zlecenia for update to authenticated
  using (serwisant_user_id = auth.uid()) with check (serwisant_user_id = auth.uid());

-- ── 5. RPC: firma zaprasza serwisanta po e-mailu ──────────────
create or replace function public.invite_serwisant_to_firma(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_firma uuid;
  v_serw  uuid;
begin
  select id into v_firma from firmy where owner_user_id = auth.uid() limit 1;
  if v_firma is null then return jsonb_build_object('success', false, 'error', 'no_company'); end if;

  select ur.user_id into v_serw from user_roles ur
    where lower(ur.email) = lower(btrim(p_email)) and ur.role in ('approved','technician')
    limit 1;
  if v_serw is null then return jsonb_build_object('success', false, 'error', 'not_found'); end if;

  insert into firma_serwisanci (firma_id, serwisant_user_id, status)
    values (v_firma, v_serw, 'invited')
    on conflict (firma_id, serwisant_user_id) do update set status = 'invited';
  return jsonb_build_object('success', true);
end; $$;
grant execute on function public.invite_serwisant_to_firma(text) to authenticated;

-- ── 6. RPC: firma pobiera swoich serwisantów (nazwa/email/status) ─
create or replace function public.get_firma_serwisanci()
returns table (id uuid, serwisant_user_id uuid, email text, full_name text, status text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_firma uuid;
begin
  select f.id into v_firma from firmy f where f.owner_user_id = auth.uid() limit 1;
  if v_firma is null then return; end if;
  return query
    select fs.id, fs.serwisant_user_id, ur.email, ur.full_name, fs.status, fs.created_at
    from firma_serwisanci fs
    left join user_roles ur on ur.user_id = fs.serwisant_user_id
    where fs.firma_id = v_firma and fs.status <> 'removed'
    order by fs.created_at;
end; $$;
grant execute on function public.get_firma_serwisanci() to authenticated;

-- ── 7. RPC: serwisant pobiera oczekujące zaproszenia ──────────
create or replace function public.get_my_firma_invitations()
returns table (id uuid, firma_id uuid, firma_nazwa text, status text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select fs.id, fs.firma_id, f.nazwa, fs.status
    from firma_serwisanci fs
    join firmy f on f.id = fs.firma_id
    where fs.serwisant_user_id = auth.uid() and fs.status = 'invited'
    order by fs.created_at desc;
end; $$;
grant execute on function public.get_my_firma_invitations() to authenticated;

-- ── 8. RPC: serwisant odpowiada na zaproszenie ────────────────
create or replace function public.respond_firma_invitation(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update firma_serwisanci
    set status = case when p_accept then 'active' else 'removed' end
    where id = p_id and serwisant_user_id = auth.uid() and status = 'invited';
  if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  return jsonb_build_object('success', true);
end; $$;
grant execute on function public.respond_firma_invitation(uuid, boolean) to authenticated;

-- ── 9. RPC: admin pobiera wszystkie firmy (+ liczniki) ────────
create or replace function public.get_all_firmy()
returns table (id uuid, nazwa text, email text, telefon text, nip text, blocked boolean,
               owner_user_id uuid, serwisanci_count bigint, zlecenia_count bigint, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'forbidden';
  end if;
  return query
    select f.id, f.nazwa, f.email, f.telefon, f.nip, f.blocked, f.owner_user_id,
      (select count(*) from firma_serwisanci fs where fs.firma_id = f.id and fs.status = 'active'),
      (select count(*) from zlecenia z where z.firma_id = f.id),
      f.created_at
    from firmy f order by f.created_at desc;
end; $$;
grant execute on function public.get_all_firmy() to authenticated;

-- ── KONIEC MIGRACJI 002 ───────────────────────────────────────
-- Następnie: edge admin-create-company (tworzy konto firmy + rolę 'company').
