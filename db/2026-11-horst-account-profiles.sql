-- Account profiles are owner-private and persist inferred type while allowing manual correction.
create table if not exists public.horst_budget_accounts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 source_account_id text not null,
 name text not null,
 institution text,
 account_type text not null default 'other'
  check(account_type in ('credit_card','checking','savings','loan','other')),
 manually_overridden boolean not null default false,
 updated_at timestamptz not null default now(),
 unique(owner_id,source_account_id)
);
create index if not exists horst_budget_accounts_owner_name_idx on public.horst_budget_accounts(owner_id,lower(name));
alter table public.horst_budget_accounts enable row level security;
revoke all privileges on public.horst_budget_accounts from public,anon,authenticated;
grant select,insert,update,delete on public.horst_budget_accounts to authenticated;
drop policy if exists "owner manages budget accounts" on public.horst_budget_accounts;
create policy "owner manages budget accounts" on public.horst_budget_accounts
 for all to authenticated
 using((select auth.uid())=owner_id)
 with check((select auth.uid())=owner_id);
alter table public.horst_transactions add column if not exists source_account_id text;
alter table public.horst_transactions add column if not exists institution_name text;
