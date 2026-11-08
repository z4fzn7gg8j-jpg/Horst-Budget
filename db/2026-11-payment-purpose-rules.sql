alter table public.horst_transaction_rules
 add column if not exists payment_purpose text
 check (payment_purpose is null or payment_purpose in ('purchase','bill','debt','internal','income','refund'));
