-- PostgREST's authenticated role must not inherit TRUNCATE or other table-wide privileges.
-- TRUNCATE is not subject to row-level security.
revoke all privileges on table
  public.horst_transactions,
  public.horst_transaction_rules,
  public.horst_transaction_imports
from public, anon, authenticated;
grant select, insert, update, delete on public.horst_transactions,public.horst_transaction_rules to authenticated;
grant select on public.horst_transaction_imports to authenticated;
