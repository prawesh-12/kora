create table if not exists stripe_webhook_events (
  id text primary key,
  tenant_id text not null,
  type text not null,
  object_id text not null,
  outcome text not null default 'received',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);--> statement-breakpoint
create index if not exists stripe_webhook_events_tenant_idx on stripe_webhook_events (tenant_id);--> statement-breakpoint
create index if not exists stripe_webhook_events_object_idx on stripe_webhook_events (tenant_id, object_id);--> statement-breakpoint
alter table "stripe_webhook_events" enable row level security;--> statement-breakpoint
alter table "stripe_webhook_events" force row level security;--> statement-breakpoint
drop policy if exists kora_tenant_isolation on "stripe_webhook_events";--> statement-breakpoint
create policy kora_tenant_isolation on "stripe_webhook_events"
  using (tenant_id = current_setting('kora.tenant_id', true))
  with check (tenant_id = current_setting('kora.tenant_id', true));
