alter table public.horst_transactions
  add column if not exists classification_origin text not null default 'none'
    check (classification_origin in ('none','manual','rule','suggestion')),
  add column if not exists reviewed_at timestamptz;
-- Only signed-in owners can work with this ledger; never grant anon.
alter table public.horst_transactions enable row level security;
alter table public.horst_transaction_rules enable row level security;
alter table public.horst_transaction_imports enable row level security;
revoke all on public.horst_transactions,public.horst_transaction_rules,public.horst_transaction_imports from anon;
