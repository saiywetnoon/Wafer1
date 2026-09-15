-- ============================================================
-- Daily Crispy Roll Ledger — Supabase setup (run ONCE)
-- In Supabase: SQL Editor -> New query -> paste -> Run
-- ============================================================

-- 1) PROFILES: one row per account (owner-approval + role).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now()
);

-- 2) LEDGERS: one JSON row per user (the whole workspace).
create table if not exists public.ledgers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- `create table if not exists` does not retrofit constraints onto a table
-- created by an earlier version of this script, so add them idempotently too.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'user'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_status_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_status_check check (status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

-- 3) Auto-create a profile when someone signs up.
--    The VERY FIRST account ever becomes the owner (admin + approved).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Serialise the "first account" decision so two simultaneous sign-ups
  -- cannot both become owner.
  perform pg_advisory_xact_lock(834921);
  insert into public.profiles (id, email, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    case when not exists (select 1 from public.profiles) then 'admin' else 'user' end,
    case when not exists (select 1 from public.profiles) then 'approved' else 'pending' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4) Security: users can read only their own profile; profile changes are
--    admin-only. This is deliberately enforced in the database: allowing users
--    to update their own profile would let them set role='admin' or
--    status='approved' from browser devtools. IMPORTANT: inside a policy, a bare column like `role` refers to
--    the TARGET row, not the caller. So to detect the admin we must ask "does the
--    CURRENT user's own profile have role='admin'?" via the is_admin() helper.
alter table public.profiles enable row level security;

-- True when the currently signed-in user is an owner/admin.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- True only for an approved account. Pending/rejected accounts must not be
-- able to access a ledger even if they call the REST API directly.
create or replace function public.is_approved()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$$;

-- A client-side admin may approve/reject accounts, but identities and roles
-- are immutable after creation. If you ever need to change either, deliberately
-- disable this trigger for that one maintenance operation and re-enable it.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.role is distinct from old.role then
    raise exception 'Profile identity and role cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists profile_protect_fields on public.profiles;
create trigger profile_protect_fields
  before update on public.profiles
  for each row execute procedure public.protect_profile_fields();

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (public.is_admin())
  with check (public.is_admin());

-- 5) Legacy private ledgers (kept only so existing data can be migrated).
alter table public.ledgers enable row level security;
drop policy if exists ledgers_select on public.ledgers;
create policy ledgers_select on public.ledgers
  for select using (auth.uid() = user_id and public.is_approved());
drop policy if exists ledgers_insert on public.ledgers;
create policy ledgers_insert on public.ledgers
  for insert with check (auth.uid() = user_id and public.is_approved());
drop policy if exists ledgers_update on public.ledgers;
create policy ledgers_update on public.ledgers
  for update using (auth.uid() = user_id and public.is_approved())
with check (auth.uid() = user_id and public.is_approved());

-- 6) LEGACY shared business ledger — migration source ONLY (v1.8.5 privacy).
-- Before v1.8.5 every approved account read/wrote THIS ONE row, which is why a
-- newly registered account appeared to load everyone else's data. Since
-- v1.8.5 the app stores each account's ledger in ITS OWN `ledgers` row
-- (section 5) and NEVER reads/writes `shared_ledgers` for live data.
-- IMPORTANT — this table is locked down to the OWNER (admin) ONLY:
--   • OLD 1.8.4 (and earlier) clients on non-admin accounts are DENIED reads,
--     so they can no longer see the admin's data even before they upgrade.
--   • Only the admin may SELECT 'main' to adopt it once, and only the admin may
--     INSERT/UPDATE — a stale old build can never re-create the shared row or
--     push someone else's data into it.
create table if not exists public.shared_ledgers (
  workspace_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.shared_ledgers enable row level security;
drop policy if exists shared_ledgers_select on public.shared_ledgers;
create policy shared_ledgers_select on public.shared_ledgers
  for select using (public.is_admin());
drop policy if exists shared_ledgers_insert on public.shared_ledgers;
create policy shared_ledgers_insert on public.shared_ledgers
  for insert with check (public.is_admin());
drop policy if exists shared_ledgers_update on public.shared_ledgers;
create policy shared_ledgers_update on public.shared_ledgers
  for update using (public.is_admin()) with check (public.is_admin());

-- 7) Enable realtime so edits on one device appear on others instantly.
-- Supabase creates this publication for a project; never drop/recreate it,
-- because that can remove other tables already using realtime.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ledgers'
  ) then
    alter publication supabase_realtime add table public.ledgers;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_ledgers'
  ) then
    alter publication supabase_realtime add table public.shared_ledgers;
  end if;
end;
$$;
alter table public.ledgers replica identity full;
alter table public.shared_ledgers replica identity full;

-- 8) Recalculate updated_at automatically on every upsert.
create or replace function public.touch_ledger()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists ledger_touch on public.ledgers;
create trigger ledger_touch before insert or update on public.ledgers
  for each row execute procedure public.touch_ledger();
drop trigger if exists shared_ledger_touch on public.shared_ledgers;
create trigger shared_ledger_touch before insert or update on public.shared_ledgers
  for each row execute procedure public.touch_ledger();
-- ============================================================
-- IMPORTANT — accounts created BEFORE this script first ran
-- ------------------------------------------------------------
-- The auto-approve trigger above (handle_new_user) only fires for NEW
-- sign-ups. If you already had users when you first ran this SQL, they have
-- NO profile row -> is_approved() is false -> they are locked out and do not
-- even appear in the Admin console. Run this ONCE to backfill them:
--
--   insert into public.profiles (id, email, role, status, created_at)
--   select id, email, 'user',
--          case when not exists (select 1 from public.profiles) then 'admin' else 'pending' end,
--          now()
--   from auth.users
--   where id not in (select id from public.profiles)
--   on conflict (id) do nothing;
--
-- Then open the Admin console on an admin device and approve the pending ones.
-- ============================================================

-- ============================================================
-- v1.8.5 UPGRADE — ACCOUNT PRIVACY (RUN ONCE, idempotent)
-- ------------------------------------------------------------
-- WHAT CHANGED: the app now reads/writes ITS OWN `ledgers.user_id` row.
-- `shared_ledgers` is migration-source only AND locked to the owner/admin.
-- New accounts therefore start EMPTY and can never see another account's data
-- (even old 1.8.4 clients are denied reads of the legacy row).
--
-- 1) `ledgers` RLS already scopes every read/write to auth.uid() = user_id
--    (section 5) — no policy change needed. Verify they exist:
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ledgers' and policyname='ledgers_select') then
    create policy ledgers_select on public.ledgers
      for select using (auth.uid() = user_id and public.is_approved());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ledgers' and policyname='ledgers_insert') then
    create policy ledgers_insert on public.ledgers
      for insert with check (auth.uid() = user_id and public.is_approved());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ledgers' and policyname='ledgers_update') then
    create policy ledgers_update on public.ledgers
      for update using (auth.uid() = user_id and public.is_approved())
      with check (auth.uid() = user_id and public.is_approved());
  end if;
end;
$$;

-- 1b) One-time legacy adoption — OWNER/ADMIN ONLY.
--     When the admin opens the app for the first time after the upgrade, this
--     copies the old shared_ledgers payload into the ADMIN's own `ledgers` row
--     (WINS over any older private row — 'main' holds everything since the
--     shared era) and deletes the shared row (atomic). A NON-ADMIN account is
--     never given the legacy payload — it returns the same "empty" answer — so
--     a new account that happens to open first can never swallow the owner's data.
create or replace function public.ledger_adopt_shared(p_workspace_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_upd timestamptz;
begin
  -- Only the owner (admin) may adopt the legacy workspace. Everyone else is
  -- told "empty" — this is the hard guarantee that a new/staff account never
  -- receives another user's data, even through the RPC.
  if not public.is_admin() then
    return jsonb_build_object('payload', null, 'updated_at', null);
  end if;
  -- The legacy shared row (if any) WINS over an older private row: 'main'
  -- contains everything recorded since the shared era, so adopting it over a
  -- stale pre-shared row must not lose the newest data.
  select payload, updated_at into v_payload, v_upd
    from public.shared_ledgers where workspace_id = p_workspace_id;
  if v_payload is not null then
    insert into public.ledgers (user_id, payload, updated_at)
    values (auth.uid(), v_payload, coalesce(v_upd, now()))
    on conflict (user_id) do update
      set payload = excluded.payload, updated_at = excluded.updated_at;
    delete from public.shared_ledgers where workspace_id = p_workspace_id;
    return jsonb_build_object('payload', v_payload, 'updated_at', coalesce(v_upd, now()));
  end if;
  -- No shared row left -> the admin's own row (if any) is authoritative.
  select payload, updated_at into v_payload, v_upd
    from public.ledgers where user_id = auth.uid();
  if v_payload is not null then
    return jsonb_build_object('payload', v_payload, 'updated_at', coalesce(v_upd, now()));
  end if;
  return jsonb_build_object('payload', null, 'updated_at', null);
end;
$$;

-- 2) Realtime must deliver an account's OWN row only (already attempted in
--    section 7, re-asserted here for databases that ran an OLDER setup).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ledgers'
  ) then
    alter publication supabase_realtime add table public.ledgers;
  end if;
end;
$$;

-- 3) AFTER THE ADMIN'S FIRST LOGIN has adopted the old shared data into the
--    admin's own row (the app does it automatically), you may clear any
--    leftover legacy shared row so nobody on an old cached build can keep it.
--    Run this in the SQL editor once, as the owner (needs elevated rights):
--
--      delete from public.shared_ledgers where workspace_id = 'main';
--
-- ============================================================
