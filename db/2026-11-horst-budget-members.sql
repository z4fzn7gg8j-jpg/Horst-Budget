create table if not exists public.horst_budget_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check(role in ('owner','member')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.horst_budget_members enable row level security;
revoke all on public.horst_budget_members from public,anon,authenticated;
grant select on public.horst_budget_members to authenticated;
drop policy if exists "member may read membership" on public.horst_budget_members;
create policy "member may read membership" on public.horst_budget_members for select to authenticated using((select auth.uid())=user_id);
insert into public.horst_budget_members(user_id,role,active)
values ('0c0da4f7-58c7-43da-8fcd-b1fb4a23abd7','owner',true)
on conflict(user_id) do update set role='owner', active=true;
create schema if not exists horst_private;
revoke all on schema horst_private from public,anon,authenticated;
create table if not exists horst_private.bill_planner_backup_20261108 as
select id,payload,updated_at,now()::timestamptz as backed_up_at from public.bill_planner_data;
