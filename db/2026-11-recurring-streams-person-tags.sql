-- Subscriptions/recurring detections and optional person attribution.
-- Recurring detections are forecasts, separate from actual expenses and manual bills.
alter table public.horst_transactions
  add column if not exists person_tag text
  check (person_tag is null or char_length(btrim(person_tag)) between 1 and 80);

create index if not exists horst_transactions_person_date_idx
  on public.horst_transactions(owner_id,person_tag,txn_date desc);

create table if not exists public.horst_recurring_streams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  stream_key text not null,
  source text not null default 'chatgpt_finances',
  merchant text not null,
  description text,
  account_name text,
  recurring_type text not null default 'OTHER'
    check (recurring_type in ('SUBSCRIPTION','BILL','MORTGAGE','OTHER')),
  frequency text,
  predicted_next_date date,
  last_date date,
  typical_amount numeric(14,2),
  last_amount numeric(14,2),
  category_hint text,
  active boolean not null default true,
  hidden boolean not null default false,
  synced_at timestamptz not null default now(),
  unique(owner_id,stream_key)
);

create index if not exists horst_recurring_owner_next_idx
  on public.horst_recurring_streams(owner_id,predicted_next_date)
  where active and not hidden;

alter table public.horst_recurring_streams enable row level security;
revoke all privileges on public.horst_recurring_streams from public, anon, authenticated;
grant select,insert,update,delete on public.horst_recurring_streams to authenticated;

drop policy if exists "owner manages recurring streams" on public.horst_recurring_streams;
create policy "owner manages recurring streams" on public.horst_recurring_streams
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
