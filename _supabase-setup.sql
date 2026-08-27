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

-- 5) Ledgers: strictly per-user (even the admin cannot read another row).
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

-- 6) Enable realtime so edits on one device appear on others instantly.
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
end;
$$;
alter table public.ledgers replica identity full;

-- 7) Recalculate updated_at automatically on every upsert.
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
