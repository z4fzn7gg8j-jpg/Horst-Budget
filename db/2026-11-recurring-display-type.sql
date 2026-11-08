-- User overrides for recurring detection grouping. Predictions are not ledger spending.
alter table public.horst_recurring_streams
  add column if not exists display_type text
  check (display_type is null or display_type in ('bill','subscription','recurring'));
-- Null means follow source detection. Overrides survive daily stream imports.
