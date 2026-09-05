create table if not exists tenant_settings (
  tenant_id text primary key references tenants (id) on delete cascade,
  stripe_secret_encrypted text,
  stripe_fixtures jsonb,
  updated_at timestamptz not null default now()
);--> statement-breakpoint
alter table "tenant_settings" enable row level security;--> statement-breakpoint
alter table "tenant_settings" force row level security;--> statement-breakpoint
drop policy if exists kora_tenant_isolation on "tenant_settings";--> statement-breakpoint
create policy kora_tenant_isolation on "tenant_settings"
  using (tenant_id = current_setting('kora.tenant_id', true))
  with check (tenant_id = current_setting('kora.tenant_id', true));
