-- Remember similar transactions, not every charge from a merchant.
-- match_context includes charge purpose, account, description, and purchase amount.
alter table public.horst_transaction_rules
  add column if not exists match_context text not null default '';
alter table public.horst_transaction_rules
  drop constraint if exists horst_transaction_rules_owner_id_merchant_match_key;
create unique index if not exists horst_transaction_rules_owner_context_key
  on public.horst_transaction_rules(owner_id,merchant_match,match_context);
-- Old broad merchant-only rules are not safe to reactivate without reviewing scope.
update public.horst_transaction_rules set enabled=false where match_context='';
