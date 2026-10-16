-- PortfolioMgmt account cloud storage.
-- Run in Supabase SQL Editor if you need to recreate this schema.
create table if not exists public.portfolios (
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, app)
);

alter table public.portfolios enable row level security;

drop policy if exists "read own portfolio" on public.portfolios;
create policy "read own portfolio"
  on public.portfolios for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "insert own portfolio" on public.portfolios;
create policy "insert own portfolio"
  on public.portfolios for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "update own portfolio" on public.portfolios;
create policy "update own portfolio"
  on public.portfolios for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.portfolios to authenticated;

