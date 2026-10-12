-- Poker Trainer: tables for per-player progress.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- Every player can read and write only their own rows (Row Level Security).

create table if not exists public.user_data (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  key        text   not null check (key in ('prefs', 'stats-lifetime', 'stats-session')),
  value      text   not null,
  updated_at bigint not null,
  primary key (user_id, key)
);

create table if not exists public.hands (
  user_id uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id      text   not null,
  data    text   not null,
  ts      bigint not null,
  primary key (user_id, id)
);

alter table public.user_data enable row level security;
alter table public.hands enable row level security;

drop policy if exists "own rows" on public.user_data;
create policy "own rows" on public.user_data
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own rows" on public.hands;
create policy "own rows" on public.hands
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_data, public.hands to authenticated;
