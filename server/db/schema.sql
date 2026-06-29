-- Whistle MVP1 ticket-spine schema draft.
-- Postgres is the planned source of truth for lifecycle state, SLA, queues,
-- evidence metadata, and audit ledger.

create extension if not exists pgcrypto;

create table if not exists jurisdictions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('state', 'district', 'constituency', 'ward', 'ministry', 'protected')),
  code text not null,
  name text not null,
  parent_id uuid references jurisdictions(id),
  created_at timestamptz not null default now(),
  unique (kind, code)
);

create table if not exists categories (
  id text primary key,
  label_en text not null,
  label_ta text not null,
  sensitivity text not null check (sensitivity in ('public_aggregate', 'identity_masked', 'protected')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists category_readiness (
  category_id text primary key references categories(id),
  primary_owner text not null,
  sla_summary text not null,
  escalation_path text not null,
  role_access text[] not null default '{}',
  public_visibility text not null,
  privacy_level text not null check (privacy_level in ('public_aggregate', 'identity_masked', 'protected')),
  sop_status text not null check (sop_status in ('approved', 'scheduled', 'required')),
  training_status text not null check (training_status in ('approved', 'scheduled', 'required')),
  launch_state text not null check (launch_state in ('ready', 'pilot_only', 'blocked')),
  notes text not null default '',
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);

create table if not exists sla_policies (
  stage text primary key,
  label text not null,
  duration_days integer not null check (duration_days between 1 and 60),
  escalation_target text not null,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);

create table if not exists app_controls (
  id text primary key,
  control_group text not null,
  name text not null,
  value_json jsonb not null,
  value_type text not null check (value_type in ('boolean', 'number', 'string')),
  critical boolean not null default false,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);

create table if not exists whistle_accounts (
  id text primary key,
  phone text not null,
  phone_masked text not null,
  display_name text not null,
  surface text not null check (surface in ('citizen', 'government')),
  actor_key text not null,
  roles text[] not null,
  status text not null check (status in ('active', 'inactive')),
  password_hash text not null,
  password_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (surface, phone)
);

create table if not exists whistle_account_sessions (
  session_token text primary key,
  account_id text not null references whistle_accounts(id),
  phone text not null,
  phone_masked text not null,
  display_name text not null,
  surface text not null check (surface in ('citizen', 'government')),
  actor_key text not null,
  role text not null,
  roles text[] not null,
  phone_verification_token text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists whistle_account_sessions_expiry_idx
  on whistle_account_sessions (expires_at);

create table if not exists config_change_requests (
  id text primary key,
  target_kind text not null check (target_kind in ('category', 'sla_policy', 'category_readiness', 'app_control')),
  target_id text not null,
  payload jsonb not null,
  summary text not null,
  reason text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by text,
  decision_reason text,
  decided_at timestamptz,
  applied_at timestamptz
);

alter table config_change_requests drop constraint if exists config_change_requests_target_kind_check;
alter table config_change_requests add constraint config_change_requests_target_kind_check
  check (target_kind in ('category', 'sla_policy', 'category_readiness', 'app_control'));

create table if not exists access_users (
  id text primary key default gen_random_uuid()::text,
  actor_key text not null unique,
  display_name text not null,
  status text not null check (status in ('active', 'inactive')),
  mfa_state text not null check (mfa_state in ('not_required_mvp', 'pending', 'enabled')),
  created_at timestamptz not null default now()
);

create table if not exists access_teams (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  role text not null check (role in ('admin', 'cm_cell', 'minister', 'department_officer', 'mla', 'councillor', 'verification', 'worker')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  owner_actor_key text not null,
  default_scope_kind text not null check (default_scope_kind in ('state', 'district', 'constituency', 'ward', 'ministry', 'protected', 'queue', 'system')),
  default_scope_value text not null,
  created_at timestamptz not null default now()
);

create table if not exists team_memberships (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references access_users(id),
  team_id text not null references access_teams(id),
  role_label text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, team_id)
);

create table if not exists role_grants (
  id text primary key default gen_random_uuid()::text,
  target_type text not null check (target_type in ('user', 'team')),
  target_id text not null,
  role text not null check (role in ('admin', 'cm_cell', 'minister', 'department_officer', 'mla', 'councillor', 'verification', 'worker')),
  scope_kind text not null check (scope_kind in ('state', 'district', 'constituency', 'ward', 'ministry', 'protected', 'queue', 'system')),
  scope_value text not null,
  protected_access boolean not null default false,
  reporter_identity boolean not null default false,
  actions text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists access_review_events (
  id text primary key default gen_random_uuid()::text,
  actor_key text not null,
  action text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create table if not exists public_rate_limit_buckets (
  rule_id text not null,
  bucket_key text not null,
  request_count integer not null check (request_count >= 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (rule_id, bucket_key)
);

create index if not exists public_rate_limit_buckets_reset_idx
  on public_rate_limit_buckets (reset_at);

alter table access_teams drop constraint if exists access_teams_role_check;
alter table access_teams add constraint access_teams_role_check
  check (role in ('admin', 'cm_cell', 'minister', 'department_officer', 'mla', 'councillor', 'verification', 'worker'));

alter table role_grants drop constraint if exists role_grants_role_check;
alter table role_grants add constraint role_grants_role_check
  check (role in ('admin', 'cm_cell', 'minister', 'department_officer', 'mla', 'councillor', 'verification', 'worker'));

create table if not exists tickets (
  id text primary key,
  category_id text not null references categories(id),
  language text not null check (language in ('en', 'ta')),
  title text not null,
  description text not null,
  reference text,
  department_hint text,
  status text not null,
  is_protected boolean not null default false,
  citizen_phone_masked text not null,
  citizen_phone_hash text not null,
  location jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tickets add column if not exists citizen_phone_hash text;

create index if not exists idx_tickets_citizen_phone_hash_updated
  on tickets (citizen_phone_hash, updated_at desc)
  where citizen_phone_hash is not null;

create index if not exists idx_tickets_citizen_phone_hash_updated_cursor
  on tickets (citizen_phone_hash, updated_at desc, id desc)
  where citizen_phone_hash is not null;

create table if not exists ticket_status_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null references tickets(id),
  from_status text,
  to_status text not null,
  actor_key text not null default 'system:database',
  reason text not null default 'status transition recorded by database',
  correlation_id text not null default 'db-trigger',
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function record_ticket_status_history()
returns trigger
language plpgsql
as $$
declare
  actor_value text;
  reason_value text;
  correlation_value text;
begin
  actor_value := coalesce(nullif(current_setting('whistle.actor', true), ''), 'system:database');
  reason_value := coalesce(nullif(current_setting('whistle.status_reason', true), ''), 'status transition recorded by database');
  correlation_value := coalesce(nullif(current_setting('whistle.correlation_id', true), ''), 'db-trigger');

  if tg_op = 'INSERT' then
    insert into ticket_status_history (
      ticket_id, from_status, to_status, actor_key, reason, correlation_id, changed_at
    )
    values (
      new.id, null, new.status, actor_value, reason_value, correlation_value, coalesce(new.created_at, now())
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into ticket_status_history (
      ticket_id, from_status, to_status, actor_key, reason, correlation_id, changed_at
    )
    values (
      new.id, old.status, new.status, actor_value, reason_value, correlation_value, coalesce(new.updated_at, now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_record_status_insert on tickets;
create trigger tickets_record_status_insert
  after insert on tickets
  for each row execute function record_ticket_status_history();

drop trigger if exists tickets_record_status_update on tickets;
create trigger tickets_record_status_update
  after update of status on tickets
  for each row execute function record_ticket_status_history();

insert into ticket_status_history (
  ticket_id, from_status, to_status, actor_key, reason, correlation_id, changed_at
)
select
  tickets.id,
  null,
  tickets.status,
  'system:migration',
  'status history baseline for existing ticket',
  'migration',
  tickets.created_at
from tickets
where not exists (
  select 1
  from ticket_status_history history
  where history.ticket_id = tickets.id
);

create table if not exists ticket_queue_assignments (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null references tickets(id),
  queue_kind text not null,
  owner_key text not null,
  owner_label text not null,
  scope_kind text not null,
  scope_value text not null,
  is_primary boolean not null default false,
  assigned_at timestamptz not null default now(),
  released_at timestamptz
);

alter table ticket_queue_assignments drop constraint if exists ticket_queue_assignments_check;

create table if not exists sla_clock_segments (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null references tickets(id),
  stage text not null,
  state text not null,
  started_at timestamptz not null default now(),
  due_at timestamptz,
  paused_at timestamptz,
  ended_at timestamptz
);

create table if not exists ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null references tickets(id),
  event_type text not null,
  actor_key text not null,
  message text not null,
  visibility text not null check (visibility in ('citizen', 'government', 'protected')),
  created_at timestamptz not null default now()
);

create table if not exists evidence_objects (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null references tickets(id),
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_key text,
  storage_state text not null,
  checksum text,
  security_controls jsonb not null default '{"classification":"standard","retentionPolicy":"standard_180_days","retentionUntil":null,"encryptionContext":"evidence:standard","metadataStripped":true,"downloadAllowed":false,"watermarkRequired":true}'::jsonb,
  created_at timestamptz not null default now()
);

alter table evidence_objects add column if not exists security_controls jsonb
  not null default '{"classification":"standard","retentionPolicy":"standard_180_days","retentionUntil":null,"encryptionContext":"evidence:standard","metadataStripped":true,"downloadAllowed":false,"watermarkRequired":true}'::jsonb;

create table if not exists audit_ledger (
  id uuid primary key default gen_random_uuid(),
  ticket_id text references tickets(id),
  actor_key text not null,
  actor_role text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  reason text,
  correlation_id text not null,
  sensitive boolean not null default false,
  created_at timestamptz not null default now()
);

alter table audit_ledger add column if not exists previous_hash text;
alter table audit_ledger add column if not exists event_hash text;
alter table audit_ledger add column if not exists chain_sequence bigint;
create sequence if not exists audit_ledger_chain_sequence_seq;
alter sequence audit_ledger_chain_sequence_seq owned by audit_ledger.chain_sequence;
alter table audit_ledger alter column chain_sequence set default nextval('audit_ledger_chain_sequence_seq');
update audit_ledger set chain_sequence = nextval('audit_ledger_chain_sequence_seq') where chain_sequence is null;
select setval('audit_ledger_chain_sequence_seq', greatest(coalesce((select max(chain_sequence) from audit_ledger), 0), 1), true);
alter table audit_ledger alter column chain_sequence set not null;

create or replace function prevent_audit_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_ledger is append-only';
end;
$$;

drop trigger if exists audit_ledger_prevent_update on audit_ledger;
create trigger audit_ledger_prevent_update
  before update on audit_ledger
  for each row execute function prevent_audit_ledger_mutation();

drop trigger if exists audit_ledger_prevent_delete on audit_ledger;
create trigger audit_ledger_prevent_delete
  before delete on audit_ledger
  for each row execute function prevent_audit_ledger_mutation();

create table if not exists idempotency_records (
  scope text not null,
  key text not null,
  request_hash text not null,
  action text not null check (action in ('ticket.create', 'verification.decision', 'citizen.update', 'citizen.dispute_reopen')),
  response_ticket_id text references tickets(id),
  created_at timestamptz not null default now(),
  primary key (scope, key)
);
alter table idempotency_records alter column response_ticket_id drop not null;

create table if not exists citizen_phone_verifications (
  challenge_id text primary key,
  phone_masked text not null,
  phone_hash text not null,
  otp_hash text not null,
  status text not null check (status in ('pending', 'verified', 'expired', 'locked')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  verification_token text unique,
  expires_at timestamptz not null,
  token_expires_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notification_outbox (
  id text primary key,
  ticket_id text not null references tickets(id),
  channel text not null check (channel in ('in_app', 'sms', 'whatsapp')),
  status text not null check (status in ('queued', 'sent', 'failed', 'suppressed')),
  topic text not null,
  language text not null check (language in ('en', 'ta')),
  recipient_masked text not null,
  safe_message text not null,
  sensitive boolean not null default false,
  provider text,
  provider_message_id text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table notification_outbox add column if not exists provider_message_id text;

create table if not exists agent_recommendation_runs (
  id text primary key,
  ticket_id text not null references tickets(id),
  actor_key text not null,
  purpose text not null check (purpose in ('intake_verification')),
  prompt_version text not null,
  model_version text not null,
  input_hash text not null,
  recommendation jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists dashboard_brief_runs (
  id text primary key,
  actor_key text not null,
  purpose text not null check (purpose in ('dashboard_sla_brief')),
  role text not null check (role in ('cm_cell', 'minister')),
  scope jsonb not null,
  prompt_version text not null,
  model_version text not null,
  input_hash text not null,
  brief jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function whistle_rls_setting(name text)
returns text
language sql
stable
as $$
  select nullif(current_setting(name, true), '');
$$;

create or replace function whistle_rls_role()
returns text
language sql
stable
as $$
  select whistle_rls_setting('whistle.role');
$$;

create or replace function whistle_rls_has_scope(scope_kind text, scope_value text)
returns boolean
language sql
stable
as $$
  select coalesce(
    lower(scope_kind || ':' || scope_value) = any(
      string_to_array(lower(coalesce(whistle_rls_setting('whistle.scope_keys'), '')), '|')
    ),
    false
  );
$$;

create or replace function whistle_rls_can_read_ticket(target_ticket_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target_ticket as (
    select id, is_protected, citizen_phone_hash
    from tickets
    where id = target_ticket_id
  )
  select exists (
    select 1
    from target_ticket ticket
    where
      whistle_rls_role() in ('admin', 'cm_cell', 'verification', 'worker')
      or (
        whistle_rls_role() = 'citizen'
        and ticket.citizen_phone_hash = whistle_rls_setting('whistle.citizen_phone_hash')
      )
      or (
        ticket.is_protected
        and whistle_rls_has_scope('protected', 'corruption')
      )
      or (
        not ticket.is_protected
        and exists (
          select 1
          from ticket_queue_assignments queue
          where queue.ticket_id = ticket.id
            and queue.released_at is null
            and (
              whistle_rls_has_scope(queue.scope_kind, queue.scope_value)
              or whistle_rls_has_scope('queue', queue.queue_kind)
            )
        )
      )
  );
$$;

create or replace function whistle_rls_can_insert_ticket(target_citizen_phone_hash text)
returns boolean
language sql
stable
as $$
  select coalesce(
    whistle_rls_role() in ('admin', 'verification')
    or (
      whistle_rls_role() = 'citizen'
      and target_citizen_phone_hash = whistle_rls_setting('whistle.citizen_phone_hash')
    ),
    false
  );
$$;

create or replace function whistle_rls_can_write_ticket(target_ticket_id text, target_citizen_phone_hash text)
returns boolean
language sql
stable
as $$
  select coalesce(
    whistle_rls_role() in ('admin', 'cm_cell', 'verification', 'worker')
    or (
      whistle_rls_role() = 'citizen'
      and target_citizen_phone_hash = whistle_rls_setting('whistle.citizen_phone_hash')
    )
    or (
      whistle_rls_role() in ('minister', 'department_officer', 'mla', 'councillor')
      and whistle_rls_can_read_ticket(target_ticket_id)
    ),
    false
  );
$$;

create or replace function whistle_rls_can_read_ticket_owned_record(target_ticket_id text)
returns boolean
language sql
stable
as $$
  select target_ticket_id is not null and whistle_rls_can_read_ticket(target_ticket_id);
$$;

create or replace function whistle_rls_can_write_ticket_owned_record(target_ticket_id text)
returns boolean
language sql
stable
as $$
  select target_ticket_id is not null and whistle_rls_can_write_ticket(target_ticket_id, coalesce((select citizen_phone_hash from tickets where id = target_ticket_id), ''));
$$;

alter table tickets enable row level security;
drop policy if exists tickets_whistle_select on tickets;
create policy tickets_whistle_select on tickets
  for select
  using (whistle_rls_can_read_ticket(id));

drop policy if exists tickets_whistle_insert on tickets;
create policy tickets_whistle_insert on tickets
  for insert
  with check (whistle_rls_can_insert_ticket(citizen_phone_hash));

drop policy if exists tickets_whistle_update on tickets;
create policy tickets_whistle_update on tickets
  for update
  using (whistle_rls_can_read_ticket(id))
  with check (whistle_rls_can_write_ticket(id, citizen_phone_hash));

alter table ticket_status_history enable row level security;
drop policy if exists ticket_status_history_whistle_select on ticket_status_history;
create policy ticket_status_history_whistle_select on ticket_status_history
  for select
  using (whistle_rls_can_read_ticket_owned_record(ticket_id));

drop policy if exists ticket_status_history_whistle_insert on ticket_status_history;
create policy ticket_status_history_whistle_insert on ticket_status_history
  for insert
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

alter table ticket_queue_assignments enable row level security;
drop policy if exists ticket_queue_assignments_whistle_select on ticket_queue_assignments;
create policy ticket_queue_assignments_whistle_select on ticket_queue_assignments
  for select
  using (whistle_rls_can_read_ticket_owned_record(ticket_id));

drop policy if exists ticket_queue_assignments_whistle_insert on ticket_queue_assignments;
create policy ticket_queue_assignments_whistle_insert on ticket_queue_assignments
  for insert
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

drop policy if exists ticket_queue_assignments_whistle_update on ticket_queue_assignments;
create policy ticket_queue_assignments_whistle_update on ticket_queue_assignments
  for update
  using (whistle_rls_can_read_ticket_owned_record(ticket_id))
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

alter table sla_clock_segments enable row level security;
drop policy if exists sla_clock_segments_whistle_select on sla_clock_segments;
create policy sla_clock_segments_whistle_select on sla_clock_segments
  for select
  using (whistle_rls_can_read_ticket_owned_record(ticket_id));

drop policy if exists sla_clock_segments_whistle_insert on sla_clock_segments;
create policy sla_clock_segments_whistle_insert on sla_clock_segments
  for insert
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

drop policy if exists sla_clock_segments_whistle_update on sla_clock_segments;
create policy sla_clock_segments_whistle_update on sla_clock_segments
  for update
  using (whistle_rls_can_read_ticket_owned_record(ticket_id))
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

alter table ticket_events enable row level security;
drop policy if exists ticket_events_whistle_select on ticket_events;
create policy ticket_events_whistle_select on ticket_events
  for select
  using (whistle_rls_can_read_ticket_owned_record(ticket_id));

drop policy if exists ticket_events_whistle_insert on ticket_events;
create policy ticket_events_whistle_insert on ticket_events
  for insert
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

alter table evidence_objects enable row level security;
drop policy if exists evidence_objects_whistle_select on evidence_objects;
create policy evidence_objects_whistle_select on evidence_objects
  for select
  using (whistle_rls_can_read_ticket_owned_record(ticket_id));

drop policy if exists evidence_objects_whistle_insert on evidence_objects;
create policy evidence_objects_whistle_insert on evidence_objects
  for insert
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

drop policy if exists evidence_objects_whistle_update on evidence_objects;
create policy evidence_objects_whistle_update on evidence_objects
  for update
  using (whistle_rls_can_read_ticket_owned_record(ticket_id))
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

alter table audit_ledger enable row level security;
drop policy if exists audit_ledger_whistle_select on audit_ledger;
create policy audit_ledger_whistle_select on audit_ledger
  for select
  using (
    (ticket_id is not null and whistle_rls_can_read_ticket(ticket_id))
    or (ticket_id is null and whistle_rls_role() in ('admin', 'cm_cell'))
  );

drop policy if exists audit_ledger_whistle_insert on audit_ledger;
create policy audit_ledger_whistle_insert on audit_ledger
  for insert
  with check (
    (ticket_id is not null and whistle_rls_can_write_ticket_owned_record(ticket_id))
    or (ticket_id is null and whistle_rls_role() in ('admin', 'cm_cell', 'worker'))
  );

alter table notification_outbox enable row level security;
drop policy if exists notification_outbox_whistle_select on notification_outbox;
create policy notification_outbox_whistle_select on notification_outbox
  for select
  using (whistle_rls_can_read_ticket_owned_record(ticket_id));

drop policy if exists notification_outbox_whistle_insert on notification_outbox;
create policy notification_outbox_whistle_insert on notification_outbox
  for insert
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

drop policy if exists notification_outbox_whistle_update on notification_outbox;
create policy notification_outbox_whistle_update on notification_outbox
  for update
  using (whistle_rls_can_read_ticket_owned_record(ticket_id))
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

alter table agent_recommendation_runs enable row level security;
drop policy if exists agent_recommendation_runs_whistle_select on agent_recommendation_runs;
create policy agent_recommendation_runs_whistle_select on agent_recommendation_runs
  for select
  using (whistle_rls_can_read_ticket_owned_record(ticket_id));

drop policy if exists agent_recommendation_runs_whistle_insert on agent_recommendation_runs;
create policy agent_recommendation_runs_whistle_insert on agent_recommendation_runs
  for insert
  with check (whistle_rls_can_write_ticket_owned_record(ticket_id));

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'whistle_app') then
    begin
      create role whistle_app nologin;
    exception
      when insufficient_privilege then
        raise notice 'whistle_app role was not created; create it in deployment IaC before using the RLS app role.';
    end;
  end if;

  if exists (select 1 from pg_roles where rolname = 'whistle_app') then
    grant usage on schema public to whistle_app;
    grant select, insert, update, delete on all tables in schema public to whistle_app;
    grant usage, select, update on all sequences in schema public to whistle_app;
  end if;
end;
$$;

insert into categories (id, label_en, label_ta, sensitivity, enabled)
values
  ('corruption', 'Corruption', 'ஊழல்', 'protected', true),
  ('roads', 'Roads', 'சாலைகள்', 'identity_masked', true),
  ('water', 'Water', 'தண்ணீர்', 'identity_masked', true),
  ('power', 'Power', 'மின்சாரம்', 'identity_masked', true),
  ('sanitation', 'Sanitation', 'சுகாதாரம்', 'identity_masked', true),
  ('safety', 'Public Safety', 'பொது பாதுகாப்பு', 'identity_masked', true),
  ('health', 'Health', 'சுகாதார சேவை', 'identity_masked', true),
  ('education', 'Education', 'கல்வி', 'identity_masked', true),
  ('revenue', 'Revenue', 'வருவாய்', 'identity_masked', true),
  ('ration', 'Ration / PDS', 'ரேஷன் / பொது விநியோகம்', 'identity_masked', true),
  ('other', 'Other', 'மற்றவை', 'identity_masked', true)
on conflict (id) do update
set label_en = excluded.label_en,
    label_ta = excluded.label_ta,
    sensitivity = excluded.sensitivity,
    enabled = excluded.enabled;

insert into category_readiness (
  category_id, primary_owner, sla_summary, escalation_path, role_access,
  public_visibility, privacy_level, sop_status, training_status, launch_state, notes, sort_order
)
values
  ('corruption', 'Protected Screening / CM Cell', 'State-configured protected screening before any wider routing', 'Protected screening -> CM Cell/protected authority', array['Verification', 'CM Cell', 'Protected Review'], 'No raw public visibility; aggregate-only after policy approval', 'protected', 'scheduled', 'scheduled', 'pilot_only', 'Keep protected-only until legal, vigilance, evidence, and safety SOPs are approved.', 1),
  ('roads', 'Local/MLA, then Highways or Local Body', '2d verification, 7d local, 10d ministry', 'Local/MLA -> Ministry -> CM Cell', array['Verification', 'MLA', 'Minister', 'CM Cell'], 'V2 aggregate only', 'identity_masked', 'approved', 'approved', 'ready', 'Core civic launch category.', 2),
  ('water', 'Local/MLA, then MAWS', '2d verification, 7d local, 10d ministry', 'Local/MLA -> Municipal Administration and Water Supply -> CM Cell', array['Verification', 'MLA', 'Minister', 'CM Cell'], 'V2 aggregate only', 'identity_masked', 'approved', 'approved', 'ready', 'Core civic launch category.', 3),
  ('power', 'Local/MLA, then Energy Department', '2d verification, 7d local, 10d ministry', 'Local/MLA -> Energy Department -> CM Cell', array['Verification', 'MLA', 'Minister', 'CM Cell'], 'V2 aggregate only', 'identity_masked', 'approved', 'approved', 'ready', 'Core civic launch category.', 4),
  ('sanitation', 'Local/MLA, then MAWS or Local Body', '2d verification, 7d local, 10d ministry', 'Local/MLA -> Municipal Administration and Water Supply -> CM Cell', array['Verification', 'MLA', 'Minister', 'CM Cell'], 'V2 aggregate only', 'identity_masked', 'approved', 'approved', 'ready', 'Core civic launch category.', 5),
  ('safety', 'Verification-approved public safety authority', 'State-configured based on severity', 'Verification -> Approved authority -> CM Cell', array['Verification', 'Restricted Owner', 'CM Cell'], 'V2 aggregate only with thresholds', 'identity_masked', 'scheduled', 'scheduled', 'pilot_only', 'Pilot with restricted SOP because public-safety reports can be sensitive.', 6),
  ('health', 'Health Department / District health office', '2d verification, 7d local, 10d ministry', 'District health office -> Health Department -> CM Cell', array['Verification', 'MLA', 'Minister', 'CM Cell'], 'V2 aggregate only', 'identity_masked', 'approved', 'approved', 'ready', 'Launch-ready for facility and service-delivery issues, not medical emergencies.', 7),
  ('education', 'School Education / Local education office', '2d verification, 7d local, 10d ministry', 'Local education office -> Education Department -> CM Cell', array['Verification', 'MLA', 'Minister', 'CM Cell'], 'V2 aggregate only', 'identity_masked', 'approved', 'approved', 'ready', 'Launch-ready for school infrastructure and service issues.', 8),
  ('revenue', 'Revenue Department / District administration', '2d verification, 7d local, 10d ministry', 'District administration -> Revenue Department -> CM Cell', array['Verification', 'MLA', 'Minister', 'CM Cell'], 'V2 aggregate only', 'identity_masked', 'approved', 'approved', 'ready', 'Launch-ready for patta, certificate, and local office service-delay issues.', 9),
  ('ration', 'Food and Civil Supplies / PDS', '2d verification, 7d local, 10d ministry', 'Local PDS owner -> Food and Civil Supplies -> CM Cell', array['Verification', 'MLA', 'Minister', 'CM Cell'], 'V2 aggregate only', 'identity_masked', 'approved', 'approved', 'ready', 'Launch-ready for ration shop access, stock, and service issues.', 10),
  ('other', 'Verification determines owner', 'State-configured after intake classification', 'Verification -> Assigned owner -> Ministry/CM Cell', array['Verification', 'Assigned Owner', 'CM Cell'], 'V2 aggregate only', 'identity_masked', 'scheduled', 'scheduled', 'pilot_only', 'Use as controlled intake until category routing quality is proven.', 11)
on conflict (category_id) do nothing;

insert into access_users (id, actor_key, display_name, status, mfa_state, created_at)
values
  ('usr-admin-prototype', 'admin:prototype', 'Prototype Admin', 'active', 'not_required_mvp', '2026-05-31T00:00:00.000Z'),
  ('usr-admin-reviewer', 'admin:reviewer', 'Prototype Admin Reviewer', 'active', 'not_required_mvp', '2026-05-31T00:00:00.000Z'),
  ('usr-cm-prototype', 'cm_cell:prototype', 'CM Cell Prototype Officer', 'active', 'not_required_mvp', '2026-05-31T00:00:00.000Z'),
  ('usr-verification-prototype', 'verification:prototype', 'Verification Prototype Officer', 'active', 'not_required_mvp', '2026-05-31T00:00:00.000Z'),
  ('usr-minister-prototype', 'minister:prototype', 'Minister Prototype User', 'active', 'not_required_mvp', '2026-05-31T00:00:00.000Z'),
  ('usr-dept-officer-prototype', 'department_officer:prototype', 'Department Officer Prototype User', 'active', 'not_required_mvp', '2026-05-31T00:00:00.000Z'),
  ('usr-mla-prototype', 'mla:prototype', 'MLA Prototype User', 'active', 'not_required_mvp', '2026-05-31T00:00:00.000Z'),
  ('usr-councillor-prototype', 'councillor:prototype', 'Councillor Prototype User', 'active', 'not_required_mvp', '2026-05-31T00:00:00.000Z'),
  ('usr-worker-prototype', 'worker:prototype', 'MVP Worker', 'active', 'not_required_mvp', '2026-05-31T00:00:00.000Z')
on conflict (id) do update
set actor_key = excluded.actor_key,
    display_name = excluded.display_name,
    status = excluded.status,
    mfa_state = excluded.mfa_state;

insert into access_teams (id, name, role, status, owner_actor_key, default_scope_kind, default_scope_value, created_at)
values
  ('team-admin', 'Whistle Admin Operators', 'admin', 'active', 'admin:prototype', 'system', 'whistle', '2026-05-31T00:00:00.000Z'),
  ('team-cm-cell', 'CM Cell Command', 'cm_cell', 'active', 'cm_cell:prototype', 'state', 'Tamil Nadu', '2026-05-31T00:00:00.000Z'),
  ('team-verification', 'Ticket Verification Team', 'verification', 'active', 'verification:prototype', 'queue', 'verification', '2026-05-31T00:00:00.000Z'),
  ('team-min-maws', 'MAWS Minister Team', 'minister', 'active', 'minister:prototype', 'ministry', 'Municipal Administration and Water Supply', '2026-05-31T00:00:00.000Z'),
  ('team-dept-maws', 'MAWS Department Officer Queue', 'department_officer', 'active', 'department_officer:prototype', 'ministry', 'Municipal Administration and Water Supply', '2026-05-31T00:00:00.000Z'),
  ('team-mla-velachery', 'Velachery MLA Team', 'mla', 'active', 'mla:prototype', 'constituency', 'Velachery', '2026-05-31T00:00:00.000Z'),
  ('team-ward-48', 'Ward 48 Local Owner', 'councillor', 'active', 'councillor:prototype', 'ward', 'Ward 48', '2026-05-31T00:00:00.000Z'),
  ('team-workers', 'Whistle MVP Workers', 'worker', 'active', 'admin:prototype', 'system', 'jobs', '2026-05-31T00:00:00.000Z')
on conflict (id) do update
set name = excluded.name,
    role = excluded.role,
    status = excluded.status,
    owner_actor_key = excluded.owner_actor_key,
    default_scope_kind = excluded.default_scope_kind,
    default_scope_value = excluded.default_scope_value;

insert into team_memberships (id, user_id, team_id, role_label, created_at)
values
  ('mship-admin', 'usr-admin-prototype', 'team-admin', 'Admin operator', '2026-05-31T00:00:00.000Z'),
  ('mship-admin-reviewer', 'usr-admin-reviewer', 'team-admin', 'Second approver', '2026-05-31T00:00:00.000Z'),
  ('mship-cm', 'usr-cm-prototype', 'team-cm-cell', 'Escalation officer', '2026-05-31T00:00:00.000Z'),
  ('mship-verification', 'usr-verification-prototype', 'team-verification', 'Verifier', '2026-05-31T00:00:00.000Z'),
  ('mship-minister', 'usr-minister-prototype', 'team-min-maws', 'Minister office', '2026-05-31T00:00:00.000Z'),
  ('mship-dept-officer', 'usr-dept-officer-prototype', 'team-dept-maws', 'Department operations officer', '2026-05-31T00:00:00.000Z'),
  ('mship-mla', 'usr-mla-prototype', 'team-mla-velachery', 'Constituency coordinator', '2026-05-31T00:00:00.000Z'),
  ('mship-councillor', 'usr-councillor-prototype', 'team-ward-48', 'Local owner', '2026-05-31T00:00:00.000Z'),
  ('mship-worker', 'usr-worker-prototype', 'team-workers', 'Worker', '2026-05-31T00:00:00.000Z')
on conflict (user_id, team_id) do update
set role_label = excluded.role_label;

insert into role_grants (
  id, target_type, target_id, role, scope_kind, scope_value,
  protected_access, reporter_identity, actions, created_at
)
values
  ('grant-admin', 'team', 'team-admin', 'admin', 'system', 'whistle', true, true, array['admin.config.read', 'admin.config.write', 'admin.config.approve', 'access.manage', 'dashboard.explain', 'ticket.create', 'audit.read', 'audit.export', 'notifications.outbox.read', 'observability.metrics.read', 'jobs.sla_escalations.run', 'jobs.evidence_scans.run', 'jobs.notifications.run'], '2026-05-31T00:00:00.000Z'),
  ('grant-cm-cell', 'team', 'team-cm-cell', 'cm_cell', 'state', 'Tamil Nadu', true, true, array['dashboard.read', 'dashboard.explain', 'verification.queue', 'ticket.read', 'evidence.read', 'evidence.upload_session', 'evidence.upload_complete', 'audit.read', 'audit.export', 'notifications.outbox.read', 'observability.metrics.read', 'agent.recommendation.run', 'field.action.write', 'rejection.review.write'], '2026-05-31T00:00:00.000Z'),
  ('grant-verification', 'team', 'team-verification', 'verification', 'queue', 'verification', true, true, array['verification.queue', 'verification.decision', 'ticket.create', 'ticket.read', 'evidence.read', 'evidence.upload_session', 'evidence.upload_complete', 'audit.read', 'notifications.outbox.read', 'dashboard.explain', 'agent.recommendation.run'], '2026-05-31T00:00:00.000Z'),
  ('grant-minister-maws', 'team', 'team-min-maws', 'minister', 'ministry', 'Municipal Administration and Water Supply', false, false, array['dashboard.read', 'dashboard.explain', 'ticket.read', 'evidence.read', 'agent.recommendation.run', 'field.action.write'], '2026-05-31T00:00:00.000Z'),
  ('grant-minister-rural-development', 'team', 'team-min-maws', 'minister', 'ministry', 'Rural Development & Panchayat Raj', false, false, array['dashboard.read', 'dashboard.explain', 'ticket.read', 'evidence.read', 'agent.recommendation.run', 'field.action.write'], '2026-05-31T00:00:00.000Z'),
  ('grant-minister-food-civil-supplies', 'team', 'team-min-maws', 'minister', 'ministry', 'Cooperation, Food and Consumer Protection', false, false, array['dashboard.read', 'dashboard.explain', 'ticket.read', 'evidence.read', 'agent.recommendation.run', 'field.action.write'], '2026-05-31T00:00:00.000Z'),
  ('grant-dept-officer-maws', 'team', 'team-dept-maws', 'department_officer', 'ministry', 'Municipal Administration and Water Supply', false, false, array['dashboard.read', 'dashboard.explain', 'ticket.read', 'evidence.read', 'evidence.upload_session', 'evidence.upload_complete', 'field.action.write'], '2026-05-31T00:00:00.000Z'),
  ('grant-mla-velachery', 'team', 'team-mla-velachery', 'mla', 'constituency', 'Velachery', false, false, array['dashboard.read', 'dashboard.explain', 'ticket.read', 'field.action.write'], '2026-05-31T00:00:00.000Z'),
  ('grant-councillor-ward-48', 'team', 'team-ward-48', 'councillor', 'ward', 'Ward 48', false, false, array['dashboard.read', 'dashboard.explain', 'ticket.read', 'field.action.write'], '2026-05-31T00:00:00.000Z'),
  ('grant-worker', 'team', 'team-workers', 'worker', 'system', 'jobs', false, false, array['jobs.sla_escalations.run', 'jobs.evidence_scans.run', 'jobs.notifications.run'], '2026-05-31T00:00:00.000Z')
on conflict (id) do update
set target_type = excluded.target_type,
    target_id = excluded.target_id,
    role = excluded.role,
    scope_kind = excluded.scope_kind,
    scope_value = excluded.scope_value,
    protected_access = excluded.protected_access,
    reporter_identity = excluded.reporter_identity,
    actions = excluded.actions;

insert into access_review_events (id, actor_key, action, summary, created_at)
values ('access-review-seed', 'system', 'access.seed', 'Seeded MVP prototype access users, teams, memberships, and grants.', '2026-05-31T00:00:00.000Z')
on conflict (id) do nothing;

create index if not exists tickets_status_category_idx on tickets (status, category_id, created_at desc);
create index if not exists tickets_location_district_lower_idx on tickets (lower(location->>'district'));
create index if not exists tickets_updated_at_idx on tickets (updated_at desc);
create index if not exists tickets_dashboard_cursor_idx on tickets (updated_at desc, id desc);
create index if not exists tickets_verification_cursor_idx on tickets (created_at asc, id asc);
create index if not exists categories_enabled_sensitivity_idx on categories (enabled, sensitivity);
create index if not exists category_readiness_state_idx on category_readiness (launch_state, sop_status, training_status);
create index if not exists sla_policies_enabled_idx on sla_policies (enabled, sort_order);
create index if not exists app_controls_group_idx on app_controls (control_group, sort_order);
create index if not exists config_change_requests_status_created_idx on config_change_requests (status, requested_at desc);
create index if not exists access_users_actor_key_idx on access_users (actor_key, status);
create index if not exists access_teams_role_scope_idx on access_teams (role, default_scope_kind, default_scope_value);
create index if not exists team_memberships_user_idx on team_memberships (user_id, expires_at);
create index if not exists role_grants_target_idx on role_grants (target_type, target_id, role, scope_kind, scope_value);
create index if not exists access_review_events_created_idx on access_review_events (created_at desc);
create index if not exists ticket_status_history_ticket_changed_idx on ticket_status_history (ticket_id, changed_at asc);
create index if not exists ticket_status_history_to_status_idx on ticket_status_history (to_status, changed_at desc);
create index if not exists ticket_queue_assignments_primary_idx on ticket_queue_assignments (is_primary, queue_kind, owner_key) where released_at is null;
create index if not exists ticket_queue_assignments_ticket_active_idx on ticket_queue_assignments (ticket_id, queue_kind, scope_kind, scope_value) where released_at is null;
create index if not exists ticket_queue_assignments_scope_active_idx on ticket_queue_assignments (scope_kind, lower(scope_value), queue_kind) where released_at is null;
create unique index if not exists ticket_queue_assignments_one_active_primary_idx on ticket_queue_assignments (ticket_id) where is_primary = true and released_at is null;
create index if not exists sla_clock_segments_due_idx on sla_clock_segments (stage, state, due_at) where ended_at is null;
create index if not exists ticket_events_ticket_created_idx on ticket_events (ticket_id, created_at);
create index if not exists evidence_objects_ticket_idx on evidence_objects (ticket_id, storage_state);
create index if not exists evidence_objects_scan_pending_ticket_idx on evidence_objects (storage_state, ticket_id);
create index if not exists audit_ledger_ticket_created_idx on audit_ledger (ticket_id, created_at desc);
create index if not exists audit_ledger_chain_sequence_idx on audit_ledger (chain_sequence desc);
create index if not exists audit_ledger_chain_cursor_idx on audit_ledger (chain_sequence desc, id desc);
create index if not exists audit_ledger_ticket_chain_cursor_idx on audit_ledger (ticket_id, chain_sequence desc, id desc);
create index if not exists idempotency_records_ticket_idx on idempotency_records (response_ticket_id, created_at desc);
create index if not exists citizen_phone_verifications_phone_hash_idx on citizen_phone_verifications (phone_hash, created_at desc);
create index if not exists citizen_phone_verifications_token_idx on citizen_phone_verifications (verification_token) where verification_token is not null;
create index if not exists notification_outbox_status_created_idx on notification_outbox (status, created_at);
create index if not exists notification_outbox_status_created_cursor_idx on notification_outbox (status, created_at asc, id asc);
create index if not exists notification_outbox_ticket_created_idx on notification_outbox (ticket_id, created_at desc);
create index if not exists notification_outbox_created_cursor_idx on notification_outbox (created_at desc, id desc);
create index if not exists notification_outbox_ticket_created_cursor_idx on notification_outbox (ticket_id, created_at desc, id desc);
create index if not exists agent_recommendation_runs_ticket_created_idx on agent_recommendation_runs (ticket_id, created_at desc);
create index if not exists dashboard_brief_runs_role_created_idx on dashboard_brief_runs (role, created_at desc);
