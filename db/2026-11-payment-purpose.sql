-- Purpose is separate from kind: debt repayments are transfers, not duplicate expenses.
alter table public.horst_transactions
 add column if not exists payment_purpose text
 check (payment_purpose is null or payment_purpose in ('purchase','bill','debt','internal','income','refund'));
-- One-time conservative classification; never changes merchant, user category, status or review decision.
update public.horst_transactions
set payment_purpose = case
 when kind = 'income' then 'income'
 when kind = 'refund' then 'refund'
 when kind = 'transfer' and (
   lower(merchant) similar to '%(credit card payment|apple card payment|payment to visa credit|affirm payment)%'
   or (lower(merchant)='bill payment' and account_name ilike '%card%')
 ) then 'debt'
 when kind = 'transfer' then 'internal'
 when kind = 'expense' and (lower(coalesce(category,'')) in ('bills & utilities','subscriptions','insurance')
   or lower(merchant) similar to '%(southwest gas|orbitel communications)%') then 'bill'
 else 'purchase'
end
where payment_purpose is null;
