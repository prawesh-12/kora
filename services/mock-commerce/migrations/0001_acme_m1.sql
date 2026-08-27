create table if not exists acme_refunds (
  id text primary key,
  order_id text not null references acme_orders (id) on delete cascade,
  amount_minor bigint not null,
  reason text not null,
  status text not null,
  created_at timestamptz not null,
  idempotency_key text,
  hidden boolean not null default false
);

create index if not exists acme_refunds_order_id_idx on acme_refunds (order_id);

create unique index if not exists acme_refunds_idempotency_key_idx
  on acme_refunds (idempotency_key);

create table if not exists acme_cancellations (
  id text primary key,
  order_id text not null references acme_orders (id) on delete cascade,
  reason text not null,
  status text not null,
  created_at timestamptz not null,
  idempotency_key text,
  hidden boolean not null default false
);

create index if not exists acme_cancellations_order_id_idx on acme_cancellations (order_id);

create unique index if not exists acme_cancellations_idempotency_key_idx
  on acme_cancellations (idempotency_key);

create table if not exists acme_tickets (
  id text primary key,
  order_id text references acme_orders (id) on delete cascade,
  customer_id text not null references acme_customers (id) on delete cascade,
  subject text not null,
  body text not null,
  priority text not null,
  status text not null,
  created_at timestamptz not null,
  idempotency_key text,
  hidden boolean not null default false
);

create index if not exists acme_tickets_order_id_idx on acme_tickets (order_id);

create index if not exists acme_tickets_customer_id_idx on acme_tickets (customer_id);

create unique index if not exists acme_tickets_idempotency_key_idx
  on acme_tickets (idempotency_key);

create sequence if not exists acme_refund_seq;

create sequence if not exists acme_cancellation_seq;

create sequence if not exists acme_ticket_seq;
