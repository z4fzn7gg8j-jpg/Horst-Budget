-- Preserve the shared family planner while making it private to approved signed-in members.
-- Prior backup: horst_private.bill_planner_backup_20261108
alter table public.bill_planner_data enable row level security;
drop policy if exists "allow anon full access" on public.bill_planner_data;
drop policy if exists "horst members manage shared bill plan" on public.bill_planner_data;
revoke all privileges on public.bill_planner_data from public, anon, authenticated;
grant select, insert, update, delete on public.bill_planner_data to authenticated;
create policy "horst members manage shared bill plan"
  on public.bill_planner_data for all to authenticated
  using (exists (
    select 1 from public.horst_budget_members m
    where m.user_id = (select auth.uid()) and m.active = true
  ))
  with check (exists (
    select 1 from public.horst_budget_members m
    where m.user_id = (select auth.uid()) and m.active = true
  ));
