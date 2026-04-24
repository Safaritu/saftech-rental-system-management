-- Saftech Rental ERP (Supabase/PostgreSQL)
-- Compatible with your current live tables:
--   units(id, tenant_name, tenant_phone, ...)
--   bills(unit_id, ...)
-- plus support tables used by the app.

-- ========= Current core tables =========
create table if not exists public.units (
  id text not null primary key,
  floor integer,
  tenant_name text,
  tenant_phone text,
  base_rent numeric default 0,
  security_deposit numeric default 0,
  previous_reading numeric default 0,
  current_reading numeric default 0,
  water_units numeric default 0,
  garbage_fee numeric default 100,
  total_bill numeric default 0,
  status text default 'Vacant',
  rent_due_date date,
  last_reading_at timestamp without time zone,
  updated_at timestamp without time zone default current_timestamp
);

create table if not exists public.bills (
  id bigserial not null primary key,
  unit_id character varying(10) not null references public.units(id) on delete cascade,
  month_year date default current_date,
  rent_amount numeric(10, 2) default 0,
  water_units numeric(10, 2) default 0,
  water_charge numeric(10, 2) default 0,
  garbage_fee numeric(10, 2) default 100,
  deposit_amount numeric(10, 2) default 0,
  total_amount numeric(10, 2) not null,
  status text default 'Pending',
  created_at timestamp with time zone default now()
);

alter table public.units add column if not exists security_deposit numeric default 0;
alter table public.bills add column if not exists deposit_amount numeric(10, 2) default 0;

-- ========= Optional support table (used by tenant upload flow) =========
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

create table if not exists public.app_settings (
  id integer primary key,
  property_name text default 'Saftech Resolutions Apartments',
  property_location text default 'Nairobi',
  caretaker_name text default 'Caretaker',
  caretaker_phone text default '',
  water_rate numeric default 235,
  garbage_fee numeric default 100,
  staff_pin text default '1234',
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id)
values (1)
on conflict (id) do nothing;

-- ========= Optional future-proof tables =========
create table if not exists public.payments (
  id bigserial primary key,
  unit_id varchar(10) not null references public.units(id) on delete restrict,
  tenant_phone text,
  amount numeric(12,2) not null default 0,
  method varchar(20) not null default 'Manual',
  mpesa_transaction_code varchar(32),
  mpesa_raw_text text,
  status varchar(20) not null default 'Under Review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_nonnegative check (amount >= 0),
  constraint payments_status_check check (status in ('Under Review','Confirmed','Rejected'))
);

create table if not exists public.outbound_messages (
  id bigserial primary key,
  unit_id varchar(10) references public.units(id) on delete set null,
  phone varchar(20),
  message text not null,
  status varchar(20) not null default 'Queued',
  created_at timestamptz not null default now()
);

-- ========= Indexes =========
create index if not exists idx_units_floor on public.units (floor);
create index if not exists idx_units_status on public.units (status);
create index if not exists idx_units_tenant_phone on public.units (tenant_phone);

create index if not exists idx_bills_unit_id_created_at on public.bills (unit_id, created_at desc);
create index if not exists idx_bills_status on public.bills (status);

create index if not exists idx_tenant_uploads_unit_id on public.tenant_uploads(unit_id);
create index if not exists idx_tenant_uploads_status_created_at on public.tenant_uploads(status, created_at desc);
create unique index if not exists uq_tenant_uploads_tx_code on public.tenant_uploads(tx_code) where tx_code is not null;

create index if not exists idx_payments_unit_id_created_at on public.payments (unit_id, created_at desc);
create unique index if not exists uq_payments_mpesa_code on public.payments (mpesa_transaction_code) where mpesa_transaction_code is not null;

create index if not exists idx_outbound_messages_unit_id_created_at on public.outbound_messages (unit_id, created_at desc);

