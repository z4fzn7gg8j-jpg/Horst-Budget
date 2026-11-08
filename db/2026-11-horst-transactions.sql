-- Horst Budget transaction ledger: independent of existing bill planner.
create table if not exists public.horst_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  source text not null default 'chatgpt_finances',
  txn_date date not null,
  merchant text not null,
  description text,
  amount numeric(14,2) not null,
  account_name text,
  pending boolean not null default false,
  category text,
  subcategory text,
  suggested_category text,
  suggested_subcategory text,
  review_status text not null default 'unsorted'
    check (review_status in ('auto','review','unsorted')),
  kind text not null default 'expense'
    check (kind in ('expense','income','transfer','refund')),
  exclude_from_spending boolean not null default false,
  rule_id uuid,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, source_key)
);
create index if not exists horst_transactions_owner_date_idx on public.horst_transactions(owner_id,txn_date desc);
create index if not exists horst_transactions_owner_status_idx on public.horst_transactions(owner_id,review_status);
create table if not exists public.horst_transaction_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  merchant_match text not null,
  category text not null,
  subcategory text,
  kind text not null default 'expense' check (kind in ('expense','income','transfer','refund')),
  exclude_from_spending boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(owner_id,merchant_match)
);
create index if not exists horst_rules_owner_idx on public.horst_transaction_rules(owner_id);
create table if not exists public.horst_transaction_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'started' check (status in ('started','success','failed')),
  seen_count integer not null default 0,
  inserted_count integer not null default 0,
  message text
);
alter table public.horst_transactions enable row level security;
alter table public.horst_transaction_rules enable row level security;
alter table public.horst_transaction_imports enable row level security;
revoke all on public.horst_transactions, public.horst_transaction_rules, public.horst_transaction_imports from anon;
grant select,insert,update,delete on public.horst_transactions, public.horst_transaction_rules to authenticated;
grant select on public.horst_transaction_imports to authenticated;
create policy "owner manages transactions" on public.horst_transactions for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "owner manages rules" on public.horst_transaction_rules for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "owner reads import history" on public.horst_transaction_imports for select to authenticated
  using ((select auth.uid()) = owner_id);
