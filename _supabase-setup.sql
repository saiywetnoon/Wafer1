-- ============================================================
-- Daily Crispy Roll Ledger — Supabase setup (run ONCE)
-- In Supabase: SQL Editor -> New query -> paste -> Run
-- ============================================================

-- 1) PROFILES: one row per account (owner-approval + role).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user',          -- 'admin' | 'user'
  status text not null default 'pending',     -- 'pending' | 'approved' | 'rejected'
  created_at timestamptz default now()
);

-- 2) LEDGERS: one JSON row per user (the whole workspace).
create table if not exists public.ledgers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- 3) Auto-create a profile when someone signs up.
--    The VERY FIRST account ever becomes the owner (admin + approved).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
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

-- 4) Security: EVERYONE can read their own profile, approve/reject is admin-only.
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (auth.uid() = id or role = 'admin');
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (auth.uid() = id or role = 'admin')
  with check (auth.uid() = id or role = 'admin');

-- 5) Ledgers: strictly per-user (even the admin cannot read another row).
alter table public.ledgers enable row level security;
drop policy if exists ledgers_select on public.ledgers;
create policy ledgers_select on public.ledgers
  for select using (auth.uid() = user_id);
drop policy if exists ledgers_insert on public.ledgers;
create policy ledgers_insert on public.ledgers
  for insert with check (auth.uid() = user_id);
drop policy if exists ledgers_update on public.ledgers;
create policy ledgers_update on public.ledgers
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 6) Enable realtime so edits on one device appear on others instantly.
drop publication if exists supabase_realtime;
create publication supabase_realtime;
alter publication supabase_realtime add table public.ledgers;
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