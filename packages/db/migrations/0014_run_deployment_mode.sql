-- A trace has to say which deployment mode produced it. Without this, a shadow
-- run and a production run are indistinguishable after the fact, and the shadow
-- comparison job has to guess from which tool statuses it sees.
alter table agent_runs
  add column if not exists deployment_mode text not null default 'full';

create index if not exists agent_runs_mode_started_idx
  on agent_runs (tenant_id, deployment_mode, started_at);
