-- Create table for tenant payment proof uploads
-- Run this in Supabase SQL editor.
create table if not exists public.tenant_uploads (
  id bigserial primary key,
  unit_id varchar(10) not null references public.units(id) on delete cascade,
  tenant_phone text not null,
  message text not null,
  tx_code varchar(20),
  image_url text,
  status text not null default 'Pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_uploads_status_check check (status in ('Pending', 'Approved', 'Rejected'))
);

alter table public.tenant_uploads
add column if not exists image_url text;

create index if not exists idx_tenant_uploads_unit_id on public.tenant_uploads(unit_id);
create index if not exists idx_tenant_uploads_status_created_at on public.tenant_uploads(status, created_at desc);
create unique index if not exists uq_tenant_uploads_tx_code on public.tenant_uploads(tx_code) where tx_code is not null;
