create table if not exists tickets (
  id text primary key,
  tenant_id text not null references tenants (id) on delete cascade,
  conversation_id text references conversations (id) on delete cascade,
  customer_id text not null,
  subscription_id text,
  subject text not null,
  body text not null,
  priority text not null default 'normal',
  status text not null default 'open',
  created_at timestamptz not null default now()
);--> statement-breakpoint
create index if not exists tickets_tenant_created_idx on tickets (tenant_id, created_at);--> statement-breakpoint
create index if not exists tickets_conversation_idx on tickets (conversation_id);--> statement-breakpoint
alter table "tickets" enable row level security;--> statement-breakpoint
alter table "tickets" force row level security;--> statement-breakpoint
drop policy if exists kora_tenant_isolation on "tickets";--> statement-breakpoint
create policy kora_tenant_isolation on "tickets"
  using (tenant_id = current_setting('kora.tenant_id', true))
  with check (tenant_id = current_setting('kora.tenant_id', true));
