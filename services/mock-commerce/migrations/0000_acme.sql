create table if not exists acme_customers (
  id text primary key,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists acme_orders (
  id text primary key,
  customer_id text not null references acme_customers (id) on delete cascade,
  status text not null,
  total_amount_minor bigint not null,
  currency text not null,
  placed_at timestamptz not null,
  delivered_at timestamptz
);

create table if not exists acme_order_items (
  id serial primary key,
  order_id text not null references acme_orders (id) on delete cascade,
  sku text not null,
  name text not null,
  category text not null,
  quantity integer not null,
  unit_amount_minor bigint not null
);

create table if not exists acme_replacements (
  id text primary key,
  order_id text not null references acme_orders (id) on delete cascade,
  reason text not null,
  status text not null,
  created_at timestamptz not null,
  estimated_delivery_days integer not null,
  idempotency_key text,
  hidden boolean not null default false
);

create index if not exists acme_replacements_order_id_idx on acme_replacements (order_id);

create unique index if not exists acme_replacements_idempotency_key_idx
  on acme_replacements (idempotency_key);

create table if not exists acme_idempotency (
  key text primary key,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists acme_request_log (
  id serial primary key,
  method text not null,
  path text not null,
  idempotency_key text,
  fault text,
  reached_business_logic boolean not null default false,
  created_at timestamptz not null default now()
);

create sequence if not exists acme_replacement_seq;
