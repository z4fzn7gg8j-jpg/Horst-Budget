
create table if not exists public.horst_budget_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  subcategories text[] not null default '{}',
  color text not null default '#5d8f89' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists horst_budget_categories_owner_name_idx
  on public.horst_budget_categories(owner_id,lower(name));
alter table public.horst_budget_categories enable row level security;
revoke all on public.horst_budget_categories from public,anon,authenticated;
grant select,insert,update,delete on public.horst_budget_categories to authenticated;
drop policy if exists "owner manages categories" on public.horst_budget_categories;
create policy "owner manages categories" on public.horst_budget_categories for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
insert into public.horst_budget_categories (owner_id,name,subcategories,color,position) values
 ('0c0da4f7-58c7-43da-8fcd-b1fb4a23abd7','Dining & Drinks',ARRAY['Family']::text[],'#f29b7f',1),
 ('0c0da4f7-58c7-43da-8fcd-b1fb4a23abd7','Bills & Utilities',ARRAY['Internet']::text[],'#6eac9e',2)
on conflict do nothing;
