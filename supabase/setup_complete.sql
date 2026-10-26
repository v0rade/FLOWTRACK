-- =============================================================================
-- FLOWTRACK — core schema
-- Tables: profiles, departments, purchase_requests, approval_actions,
--         audit_logs, app_settings
-- Monetary values use NUMERIC (never floating point). Request totals are a
-- generated column, so they are always calculated by the database server.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('employee', 'manager', 'admin');

create type public.request_status as enum (
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'cancelled'
);

create type public.approval_action_type as enum (
  'created',
  'submitted',
  'approved',
  'rejected',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  name        text not null unique check (char_length(btrim(name)) between 2 and 80),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger departments_touch_updated_at
  before update on public.departments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null unique,
  full_name      text not null check (char_length(btrim(full_name)) between 1 and 120),
  role           public.app_role not null default 'employee',
  department_id  uuid references public.departments (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index profiles_department_id_idx on public.profiles (department_id);
create index profiles_role_idx on public.profiles (role);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Application settings (single row) — business rules + ROI assumptions
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id                           smallint primary key default 1 check (id = 1),
  organization_name            text not null default 'Nusantara Supplies Co. (Demo)'
                                 check (char_length(btrim(organization_name)) between 2 and 120),
  currency                     text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  -- Business rule: may a manager/admin approve a request they created themselves?
  allow_self_approval          boolean not null default false,
  -- Illustrative assumptions for the before/after comparison (NOT measured data)
  manual_minutes_per_request   integer not null default 95 check (manual_minutes_per_request between 1 and 10000),
  digital_minutes_per_request  integer not null default 20 check (digital_minutes_per_request between 1 and 10000),
  manual_cycle_days            numeric(6,2) not null default 5 check (manual_cycle_days > 0 and manual_cycle_days <= 365),
  hourly_staff_cost            numeric(14,2) not null default 85000 check (hourly_staff_cost >= 0),
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.profiles (id) on delete set null
);

insert into public.app_settings (id) values (1);

create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Purchase requests
-- ---------------------------------------------------------------------------
create sequence public.purchase_request_number_seq;

create table public.purchase_requests (
  id               uuid primary key default gen_random_uuid(),
  request_number   text not null unique check (request_number ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  item_name        text not null check (char_length(btrim(item_name)) between 2 and 120),
  description      text not null default '' check (char_length(description) <= 2000),
  quantity         integer not null check (quantity between 1 and 100000),
  unit_price       numeric(15,2) not null check (unit_price >= 0 and unit_price <= 10000000000),
  total_amount     numeric(18,2) generated always as (quantity * unit_price) stored,
  department_id    uuid not null references public.departments (id) on delete restrict,
  justification    text not null check (char_length(btrim(justification)) between 10 and 2000),
  requester_id     uuid not null references public.profiles (id) on delete restrict,
  required_date    date not null,
  status           public.request_status not null default 'draft',
  submitted_at     timestamptz,
  decided_at       timestamptz,
  decided_by       uuid references public.profiles (id) on delete restrict,
  decision_comment text check (decision_comment is null or char_length(decision_comment) <= 1000),
  cancelled_at     timestamptz,
  cancelled_by     uuid references public.profiles (id) on delete restrict,
  cancel_reason    text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  source           text not null default 'web' check (source in ('web', 'csv_import', 'demo_seed')),
  version          integer not null default 1 check (version >= 1),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Keep totals inside a range that is exactly representable end-to-end.
  constraint purchase_requests_total_limit
    check (quantity * unit_price <= 99999999999.99),

  -- Each status must carry the metadata that proves how it was reached.
  constraint purchase_requests_status_consistency check (
    (status = 'draft'
       and submitted_at is null and decided_at is null and decided_by is null and cancelled_at is null)
    or (status = 'pending_approval'
       and submitted_at is not null and decided_at is null and decided_by is null and cancelled_at is null)
    or (status = 'approved'
       and submitted_at is not null and decided_at is not null and decided_by is not null and cancelled_at is null)
    or (status = 'rejected'
       and submitted_at is not null and decided_at is not null and decided_by is not null and cancelled_at is null
       and char_length(btrim(coalesce(decision_comment, ''))) >= 5)
    or (status = 'cancelled'
       and cancelled_at is not null and cancelled_by is not null and decided_at is null)
  ),
  constraint purchase_requests_timeline check (
    (submitted_at is null or submitted_at >= created_at)
    and (decided_at is null or decided_at >= submitted_at)
    and (cancelled_at is null or cancelled_at >= created_at)
  )
);

create index purchase_requests_status_idx on public.purchase_requests (status);
create index purchase_requests_department_status_idx on public.purchase_requests (department_id, status);
create index purchase_requests_requester_created_idx on public.purchase_requests (requester_id, created_at desc);
create index purchase_requests_created_at_idx on public.purchase_requests (created_at desc);
create index purchase_requests_decided_by_idx on public.purchase_requests (decided_by);
create index purchase_requests_cancelled_by_idx on public.purchase_requests (cancelled_by);

-- ---------------------------------------------------------------------------
-- Approval actions (append-only workflow history)
-- ---------------------------------------------------------------------------
create table public.approval_actions (
  id           bigint generated always as identity primary key,
  request_id   uuid not null references public.purchase_requests (id) on delete restrict,
  action       public.approval_action_type not null,
  from_status  public.request_status,
  to_status    public.request_status not null,
  actor_id     uuid references public.profiles (id) on delete restrict,
  comment      text check (comment is null or char_length(comment) <= 1000),
  created_at   timestamptz not null default now()
);

create index approval_actions_request_created_idx on public.approval_actions (request_id, created_at);
create index approval_actions_actor_idx on public.approval_actions (actor_id);
create index approval_actions_created_idx on public.approval_actions (created_at desc);

-- ---------------------------------------------------------------------------
-- Audit logs (append-only row-level change log)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id              bigint generated always as identity primary key,
  -- No ON DELETE action: audit rows are append-only, so actors with history
  -- cannot be hard-deleted (deactivate them by removing their role instead).
  actor_id        uuid references public.profiles (id),
  entity_type     text not null,
  entity_id       text not null,
  operation       text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  changed_fields  text[] not null default '{}',
  old_data        jsonb,
  new_data        jsonb,
  created_at      timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
-- =============================================================================
-- FLOWTRACK — integrity triggers, authorization helpers and workflow functions
--
-- Design:
--   * Authenticated users can only READ tables (subject to RLS).
--   * All writes go through SECURITY DEFINER functions below. Each function
--     authenticates the caller with auth.uid(), checks role/department rules,
--     locks the affected row (SELECT ... FOR UPDATE) and validates the state
--     transition. A function call is a single transaction: either every
--     change (request row, approval history, audit log) commits, or none does.
--   * Triggers enforce invariants even for privileged writers (seed scripts,
--     service role): invalid transitions and edits to locked requests raise.
--
-- Error messages start with a stable code prefix that the app maps to
-- friendly messages: NOT_AUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION,
-- INVALID_TRANSITION, LOCKED, CONFLICT, DUPLICATE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Request numbers: PR-<year>-<5 digit sequence>, skipping any value that was
-- already taken (e.g. by a CSV import that supplied its own number).
-- ---------------------------------------------------------------------------
create or replace function public.next_request_number()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_candidate text;
begin
  loop
    v_candidate := 'PR-' || to_char(now(), 'YYYY') || '-'
                   || lpad(nextval('public.purchase_request_number_seq')::text, 5, '0');
    exit when not exists (
      select 1 from public.purchase_requests where request_number = v_candidate
    );
  end loop;
  return v_candidate;
end;
$$;

alter table public.purchase_requests
  alter column request_number set default public.next_request_number();

-- ---------------------------------------------------------------------------
-- Pure transition table (mirrors src/lib/workflow.ts)
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_status_transition(
  p_from public.request_status,
  p_to   public.request_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = 'draft'            then p_to in ('pending_approval', 'cancelled')
    when p_from = 'pending_approval' then p_to in ('approved', 'rejected', 'cancelled')
    else false  -- approved, rejected and cancelled are terminal
  end;
$$;

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE guard: terminal requests are immutable, pending requests have
-- locked content, status changes must follow the transition table.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_purchase_request_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'LOCKED: Request % is % and can no longer be modified.',
      old.request_number, replace(old.status::text, '_', ' ')
      using errcode = '55000';
  end if;

  if new.request_number is distinct from old.request_number
     or new.requester_id is distinct from old.requester_id
     or new.created_at is distinct from old.created_at
     or new.source is distinct from old.source then
    raise exception 'LOCKED: Request number, requester, source and creation date are immutable.'
      using errcode = '55000';
  end if;

  if new.status is distinct from old.status
     and not public.is_valid_status_transition(old.status, new.status) then
    raise exception 'INVALID_TRANSITION: Cannot move request % from % to %.',
      old.request_number, old.status, new.status
      using errcode = '55000';
  end if;

  if old.status = 'pending_approval' and (
       new.item_name     is distinct from old.item_name
    or new.description   is distinct from old.description
    or new.quantity      is distinct from old.quantity
    or new.unit_price    is distinct from old.unit_price
    or new.department_id is distinct from old.department_id
    or new.justification is distinct from old.justification
    or new.required_date is distinct from old.required_date
  ) then
    raise exception 'LOCKED: Request % is awaiting approval; its contents cannot be edited.',
      old.request_number
      using errcode = '55000';
  end if;

  new.version    := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger purchase_requests_enforce_rules
  before update on public.purchase_requests
  for each row execute function public.enforce_purchase_request_rules();

create or replace function public.prevent_purchase_request_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LOCKED: Purchase requests cannot be deleted; cancel them instead.'
    using errcode = '55000';
end;
$$;

create trigger purchase_requests_no_delete
  before delete on public.purchase_requests
  for each row execute function public.prevent_purchase_request_delete();

-- ---------------------------------------------------------------------------
-- AFTER INSERT/UPDATE: every status change is recorded in approval_actions
-- with the actor and timestamp. Because this is a trigger, no code path can
-- change a status without leaving history.
-- ---------------------------------------------------------------------------
create or replace function public.record_purchase_request_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.approval_actions (request_id, action, from_status, to_status, actor_id, comment, created_at)
    values (new.id, 'created', null, 'draft', new.requester_id,
            case new.source when 'csv_import' then 'Imported from CSV' else null end,
            new.created_at);

    if new.submitted_at is not null then
      insert into public.approval_actions (request_id, action, from_status, to_status, actor_id, created_at)
      values (new.id, 'submitted', 'draft', 'pending_approval', new.requester_id, new.submitted_at);
    end if;

    if new.status in ('approved', 'rejected') then
      insert into public.approval_actions (request_id, action, from_status, to_status, actor_id, comment, created_at)
      values (new.id, new.status::text::public.approval_action_type, 'pending_approval', new.status,
              new.decided_by, new.decision_comment, new.decided_at);
    elsif new.status = 'cancelled' then
      insert into public.approval_actions (request_id, action, from_status, to_status, actor_id, comment, created_at)
      values (new.id, 'cancelled',
              case when new.submitted_at is null then 'draft'::public.request_status else 'pending_approval' end,
              'cancelled', new.cancelled_by, new.cancel_reason, new.cancelled_at);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.approval_actions (request_id, action, from_status, to_status, actor_id, comment, created_at)
    values (
      new.id,
      case new.status
        when 'pending_approval' then 'submitted'::public.approval_action_type
        else new.status::text::public.approval_action_type
      end,
      old.status,
      new.status,
      coalesce(
        auth.uid(),
        case new.status
          when 'pending_approval' then new.requester_id
          when 'cancelled' then new.cancelled_by
          else new.decided_by
        end
      ),
      case new.status
        when 'approved' then new.decision_comment
        when 'rejected' then new.decision_comment
        when 'cancelled' then new.cancel_reason
        else null
      end,
      coalesce(
        case new.status
          when 'pending_approval' then new.submitted_at
          when 'cancelled' then new.cancelled_at
          else new.decided_at
        end,
        now()
      )
    );
  end if;
  return new;
end;
$$;

create trigger purchase_requests_record_history
  after insert or update on public.purchase_requests
  for each row execute function public.record_purchase_request_history();

-- ---------------------------------------------------------------------------
-- Generic audit trail for business tables
-- ---------------------------------------------------------------------------
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_entity_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
      from jsonb_each(v_new) n
     where n.key not in ('updated_at', 'version')
       and (v_old -> n.key) is distinct from n.value;
    if cardinality(v_changed) = 0 then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    select coalesce(array_agg(k order by k), '{}') into v_changed from jsonb_object_keys(v_new) k;
  end if;

  v_entity_id := coalesce(v_new ->> 'id', v_old ->> 'id');

  insert into public.audit_logs (actor_id, entity_type, entity_id, operation, changed_fields, old_data, new_data)
  values (
    auth.uid(),
    case tg_table_name
      when 'purchase_requests' then 'purchase_request'
      when 'profiles' then 'profile'
      when 'departments' then 'department'
      when 'app_settings' then 'app_settings'
      else tg_table_name
    end,
    v_entity_id,
    tg_op,
    v_changed,
    v_old,
    v_new
  );

  return coalesce(new, old);
end;
$$;

create trigger purchase_requests_audit
  after insert or update on public.purchase_requests
  for each row execute function public.write_audit_log();

create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.write_audit_log();

create trigger departments_audit
  after insert or update or delete on public.departments
  for each row execute function public.write_audit_log();

create trigger app_settings_audit
  after update on public.app_settings
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- History tables are append-only
-- ---------------------------------------------------------------------------
create or replace function public.prevent_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LOCKED: % is append-only.', tg_table_name using errcode = '55000';
end;
$$;

create trigger approval_actions_append_only
  before update or delete on public.approval_actions
  for each row execute function public.prevent_history_mutation();

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.prevent_history_mutation();

-- ---------------------------------------------------------------------------
-- New auth users get an Employee profile. The role is NEVER taken from
-- user-supplied metadata; only administrators can elevate roles.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    'employee'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so RLS policies can use them
-- without recursive policy evaluation on profiles)
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.current_department_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.department_id from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = auth.uid()), false);
$$;

-- Who may read a purchase request:
--   requester; managers of the request's department; administrators.
create or replace function public.can_view_request(p_requester_id uuid, p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and (
         p.id = p_requester_id
         or p.role = 'admin'
         or (p.role = 'manager' and p.department_id = p_department_id)
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public.require_profile()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: Please sign in to continue.' using errcode = '28000';
  end if;
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'FORBIDDEN: No FLOWTRACK profile exists for this account.' using errcode = '42501';
  end if;
  return v_profile;
end;
$$;

create or replace function public.validate_request_fields(
  p_profile        public.profiles,
  p_item_name      text,
  p_description    text,
  p_quantity       integer,
  p_unit_price     numeric,
  p_department_id  uuid,
  p_justification  text,
  p_required_date  date
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_item_name is null or char_length(btrim(p_item_name)) not between 2 and 120 then
    raise exception 'VALIDATION: Item name must be between 2 and 120 characters.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_description, '')) > 2000 then
    raise exception 'VALIDATION: Description must be 2000 characters or fewer.' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity not between 1 and 100000 then
    raise exception 'VALIDATION: Quantity must be a whole number between 1 and 100,000.' using errcode = '22023';
  end if;
  if p_unit_price is null or p_unit_price < 0 or p_unit_price > 10000000000 or p_unit_price <> round(p_unit_price, 2) then
    raise exception 'VALIDATION: Unit price must be a non-negative amount with at most 2 decimals.' using errcode = '22023';
  end if;
  if p_quantity * p_unit_price > 99999999999.99 then
    raise exception 'VALIDATION: Request total exceeds the maximum allowed amount.' using errcode = '22023';
  end if;
  if p_justification is null or char_length(btrim(p_justification)) not between 10 and 2000 then
    raise exception 'VALIDATION: Business justification must be between 10 and 2000 characters.' using errcode = '22023';
  end if;
  if p_required_date is null or p_required_date < current_date - 1 then
    raise exception 'VALIDATION: Required date cannot be in the past.' using errcode = '22023';
  end if;
  if p_required_date > current_date + 730 then
    raise exception 'VALIDATION: Required date must be within the next two years.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.is_active) then
    raise exception 'VALIDATION: Department does not exist or is inactive.' using errcode = '22023';
  end if;
  if p_profile.role <> 'admin' and p_department_id is distinct from p_profile.department_id then
    raise exception 'FORBIDDEN: You can only raise requests for your own department.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workflow: create (optionally submit immediately)
-- ---------------------------------------------------------------------------
create or replace function public.create_purchase_request(
  p_item_name      text,
  p_description    text,
  p_quantity       integer,
  p_unit_price     numeric,
  p_department_id  uuid,
  p_justification  text,
  p_required_date  date,
  p_submit         boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_id uuid;
begin
  v_profile := public.require_profile();
  perform public.validate_request_fields(v_profile, p_item_name, p_description, p_quantity,
                                         p_unit_price, p_department_id, p_justification, p_required_date);

  insert into public.purchase_requests
    (item_name, description, quantity, unit_price, department_id, justification, requester_id, required_date)
  values
    (btrim(p_item_name), coalesce(btrim(p_description), ''), p_quantity, p_unit_price, p_department_id,
     btrim(p_justification), v_profile.id, p_required_date)
  returning id into v_id;

  if p_submit then
    update public.purchase_requests
       set status = 'pending_approval', submitted_at = now()
     where id = v_id;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workflow: edit a draft (requester only, optimistic concurrency via version)
-- ---------------------------------------------------------------------------
create or replace function public.update_draft_request(
  p_request_id       uuid,
  p_expected_version integer,
  p_item_name        text,
  p_description      text,
  p_quantity         integer,
  p_unit_price       numeric,
  p_department_id    uuid,
  p_justification    text,
  p_required_date    date
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_request public.purchase_requests;
  v_version integer;
begin
  v_profile := public.require_profile();

  select * into v_request from public.purchase_requests where id = p_request_id for update;
  if not found or not public.can_view_request(v_request.requester_id, v_request.department_id) then
    raise exception 'NOT_FOUND: Purchase request not found.' using errcode = 'P0002';
  end if;
  if v_request.requester_id <> v_profile.id then
    raise exception 'FORBIDDEN: Only the requester can edit a draft.' using errcode = '42501';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'LOCKED: Only draft requests can be edited (current status: %).',
      replace(v_request.status::text, '_', ' ') using errcode = '55000';
  end if;
  if v_request.version <> p_expected_version then
    raise exception 'CONFLICT: This request was changed by someone else. Reload and try again.'
      using errcode = '40001';
  end if;

  perform public.validate_request_fields(v_profile, p_item_name, p_description, p_quantity,
                                         p_unit_price, p_department_id, p_justification, p_required_date);

  update public.purchase_requests
     set item_name = btrim(p_item_name),
         description = coalesce(btrim(p_description), ''),
         quantity = p_quantity,
         unit_price = p_unit_price,
         department_id = p_department_id,
         justification = btrim(p_justification),
         required_date = p_required_date
   where id = p_request_id
  returning version into v_version;

  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workflow: submit a draft for approval (requester only)
-- ---------------------------------------------------------------------------
create or replace function public.submit_purchase_request(p_request_id uuid)
returns public.request_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_request public.purchase_requests;
begin
  v_profile := public.require_profile();

  select * into v_request from public.purchase_requests where id = p_request_id for update;
  if not found or not public.can_view_request(v_request.requester_id, v_request.department_id) then
    raise exception 'NOT_FOUND: Purchase request not found.' using errcode = 'P0002';
  end if;
  if v_request.requester_id <> v_profile.id then
    raise exception 'FORBIDDEN: Only the requester can submit this request.' using errcode = '42501';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'INVALID_TRANSITION: Request % is already %.',
      v_request.request_number, replace(v_request.status::text, '_', ' ') using errcode = '55000';
  end if;
  if v_request.required_date < current_date - 1 then
    raise exception 'VALIDATION: Required date is in the past. Edit the draft before submitting.'
      using errcode = '22023';
  end if;

  update public.purchase_requests
     set status = 'pending_approval', submitted_at = now()
   where id = p_request_id;

  return 'pending_approval';
end;
$$;

-- ---------------------------------------------------------------------------
-- Approval decision core (shared by approve/reject)
-- ---------------------------------------------------------------------------
create or replace function public.decide_purchase_request(
  p_request_id uuid,
  p_decision   public.request_status,
  p_comment    text
)
returns public.request_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_request public.purchase_requests;
  v_allow_self boolean;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'VALIDATION: Decision must be approved or rejected.' using errcode = '22023';
  end if;

  v_profile := public.require_profile();

  -- Lock the row: concurrent or duplicate decisions are serialized here.
  select * into v_request from public.purchase_requests where id = p_request_id for update;
  if not found or not public.can_view_request(v_request.requester_id, v_request.department_id) then
    raise exception 'NOT_FOUND: Purchase request not found.' using errcode = 'P0002';
  end if;

  if v_profile.role not in ('manager', 'admin') then
    raise exception 'FORBIDDEN: Only managers and administrators can approve or reject requests.'
      using errcode = '42501';
  end if;
  if v_profile.role = 'manager' and v_request.department_id is distinct from v_profile.department_id then
    raise exception 'FORBIDDEN: Managers can only decide on requests from their own department.'
      using errcode = '42501';
  end if;

  select s.allow_self_approval into v_allow_self from public.app_settings s where s.id = 1;
  if v_request.requester_id = v_profile.id and not coalesce(v_allow_self, false) then
    raise exception 'FORBIDDEN: You cannot approve or reject your own request (self-approval is disabled).'
      using errcode = '42501';
  end if;

  if v_request.status <> 'pending_approval' then
    raise exception 'INVALID_TRANSITION: Request % is % and cannot be %.',
      v_request.request_number, replace(v_request.status::text, '_', ' '), p_decision
      using errcode = '55000';
  end if;

  if p_decision = 'rejected' and (v_comment is null or char_length(v_comment) < 5) then
    raise exception 'VALIDATION: A rejection reason of at least 5 characters is required.'
      using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 1000 then
    raise exception 'VALIDATION: Comment must be 1000 characters or fewer.' using errcode = '22023';
  end if;

  update public.purchase_requests
     set status = p_decision,
         decided_at = now(),
         decided_by = v_profile.id,
         decision_comment = v_comment
   where id = p_request_id;

  return p_decision;
end;
$$;

create or replace function public.approve_purchase_request(p_request_id uuid, p_comment text default null)
returns public.request_status
language sql
volatile
security definer
set search_path = ''
as $$
  select public.decide_purchase_request(p_request_id, 'approved', p_comment);
$$;

create or replace function public.reject_purchase_request(p_request_id uuid, p_reason text)
returns public.request_status
language sql
volatile
security definer
set search_path = ''
as $$
  select public.decide_purchase_request(p_request_id, 'rejected', p_reason);
$$;

-- ---------------------------------------------------------------------------
-- Workflow: cancel (requester, or an administrator) a draft/pending request
-- ---------------------------------------------------------------------------
create or replace function public.cancel_purchase_request(p_request_id uuid, p_reason text default null)
returns public.request_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_request public.purchase_requests;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_profile := public.require_profile();

  select * into v_request from public.purchase_requests where id = p_request_id for update;
  if not found or not public.can_view_request(v_request.requester_id, v_request.department_id) then
    raise exception 'NOT_FOUND: Purchase request not found.' using errcode = 'P0002';
  end if;
  if v_request.requester_id <> v_profile.id and v_profile.role <> 'admin' then
    raise exception 'FORBIDDEN: Only the requester or an administrator can cancel this request.'
      using errcode = '42501';
  end if;
  if v_request.status not in ('draft', 'pending_approval') then
    raise exception 'INVALID_TRANSITION: Request % is % and cannot be cancelled.',
      v_request.request_number, replace(v_request.status::text, '_', ' ') using errcode = '55000';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'VALIDATION: Reason must be 1000 characters or fewer.' using errcode = '22023';
  end if;

  update public.purchase_requests
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_profile.id,
         cancel_reason = v_reason
   where id = p_request_id;

  return 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- CSV import (validated rows as JSON). With p_dry_run = true nothing is
-- written; the per-row verdicts power the preview screen. With
-- p_dry_run = false all valid, non-duplicate rows are inserted in this single
-- transaction and invalid/duplicate rows are reported and skipped.
--
-- Row shape: { request_number?, item_name, description?, quantity,
--              unit_price (string), department_code, justification,
--              required_date (YYYY-MM-DD), status? ('draft'|'pending_approval') }
-- ---------------------------------------------------------------------------
create or replace function public.import_purchase_requests(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_row jsonb;
  v_idx integer := 0;
  v_errors text[];
  v_kind text;
  v_results jsonb := '[]'::jsonb;
  v_seen_numbers text[] := '{}';
  v_seen_fingerprints text[] := '{}';
  v_number text;
  v_item text;
  v_qty integer;
  v_price numeric;
  v_dept uuid;
  v_dept_code text;
  v_just text;
  v_date date;
  v_status text;
  v_fingerprint text;
  v_new_id uuid;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_invalid integer := 0;
begin
  v_profile := public.require_profile();

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'VALIDATION: Import payload must be an array of rows.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'VALIDATION: The file contains no data rows.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'VALIDATION: A single import is limited to 500 rows.' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_errors := '{}';
    v_kind := 'valid';
    v_number := nullif(upper(btrim(coalesce(v_row ->> 'request_number', ''))), '');
    v_item := btrim(coalesce(v_row ->> 'item_name', ''));
    v_just := btrim(coalesce(v_row ->> 'justification', ''));
    v_dept_code := upper(btrim(coalesce(v_row ->> 'department_code', '')));
    v_status := coalesce(nullif(lower(btrim(coalesce(v_row ->> 'status', ''))), ''), 'draft');
    v_qty := null; v_price := null; v_date := null; v_dept := null;

    begin
      v_qty := (v_row ->> 'quantity')::integer;
    exception when others then
      v_errors := v_errors || 'Quantity must be a whole number.'::text;
    end;
    begin
      v_price := (v_row ->> 'unit_price')::numeric;
    exception when others then
      v_errors := v_errors || 'Unit price must be a number.'::text;
    end;
    begin
      v_date := (v_row ->> 'required_date')::date;
    exception when others then
      v_errors := v_errors || 'Required date must be in YYYY-MM-DD format.'::text;
    end;

    if v_number is not null and v_number !~ '^[A-Z0-9][A-Z0-9-]{2,29}$' then
      v_errors := v_errors || 'Request number may contain only letters, digits and hyphens (3-30 chars).'::text;
    end if;
    if char_length(v_item) not between 2 and 120 then
      v_errors := v_errors || 'Item name must be between 2 and 120 characters.'::text;
    end if;
    if char_length(coalesce(v_row ->> 'description', '')) > 2000 then
      v_errors := v_errors || 'Description must be 2000 characters or fewer.'::text;
    end if;
    if v_qty is not null and v_qty not between 1 and 100000 then
      v_errors := v_errors || 'Quantity must be between 1 and 100,000.'::text;
    end if;
    if v_price is not null and (v_price < 0 or v_price > 10000000000 or v_price <> round(v_price, 2)) then
      v_errors := v_errors || 'Unit price must be non-negative with at most 2 decimals.'::text;
    end if;
    if v_qty is not null and v_price is not null and v_qty * v_price > 99999999999.99 then
      v_errors := v_errors || 'Request total exceeds the maximum allowed amount.'::text;
    end if;
    if char_length(v_just) not between 10 and 2000 then
      v_errors := v_errors || 'Justification must be between 10 and 2000 characters.'::text;
    end if;
    if v_date is not null and (v_date < current_date - 1 or v_date > current_date + 730) then
      v_errors := v_errors || 'Required date must be between today and two years from now.'::text;
    end if;
    if v_status not in ('draft', 'pending_approval') then
      v_errors := v_errors || 'Status must be draft or pending_approval.'::text;
    end if;

    select d.id into v_dept from public.departments d where d.code = v_dept_code and d.is_active;
    if v_dept is null then
      v_errors := v_errors || format('Unknown or inactive department code "%s".', v_dept_code);
    elsif v_profile.role <> 'admin' and v_dept is distinct from v_profile.department_id then
      v_errors := v_errors || 'You can only import requests for your own department.'::text;
    end if;

    if cardinality(v_errors) > 0 then
      v_kind := 'invalid';
    else
      v_fingerprint := lower(v_item) || '|' || v_qty || '|' || v_price || '|' || v_dept || '|' || v_date;

      if v_number is not null and v_number = any (v_seen_numbers) then
        v_kind := 'duplicate';
        v_errors := v_errors || format('Request number %s appears more than once in this file.', v_number);
      elsif v_number is not null and exists (
        select 1 from public.purchase_requests r where r.request_number = v_number
      ) then
        v_kind := 'duplicate';
        v_errors := v_errors || format('Request number %s already exists.', v_number);
      elsif v_fingerprint = any (v_seen_fingerprints) then
        v_kind := 'duplicate';
        v_errors := v_errors || 'Identical item, quantity, price, department and date appear earlier in this file.'::text;
      elsif exists (
        select 1 from public.purchase_requests r
         where r.requester_id = v_profile.id
           and r.status in ('draft', 'pending_approval', 'approved')
           and lower(r.item_name) = lower(v_item)
           and r.quantity = v_qty and r.unit_price = v_price
           and r.department_id = v_dept and r.required_date = v_date
      ) then
        v_kind := 'duplicate';
        v_errors := v_errors || 'You already have an active request with identical details.'::text;
      end if;
    end if;

    if v_number is not null then v_seen_numbers := v_seen_numbers || v_number; end if;
    if v_kind <> 'invalid' then v_seen_fingerprints := v_seen_fingerprints || v_fingerprint; end if;

    v_new_id := null;
    if v_kind = 'valid' then
      if not p_dry_run then
        insert into public.purchase_requests
          (request_number, item_name, description, quantity, unit_price, department_id,
           justification, requester_id, required_date, source)
        values
          (coalesce(v_number, public.next_request_number()), v_item,
           btrim(coalesce(v_row ->> 'description', '')), v_qty, v_price, v_dept,
           v_just, v_profile.id, v_date, 'csv_import')
        returning id into v_new_id;

        if v_status = 'pending_approval' then
          update public.purchase_requests
             set status = 'pending_approval', submitted_at = now()
           where id = v_new_id;
        end if;
        v_inserted := v_inserted + 1;
      end if;
    elsif v_kind = 'duplicate' then
      v_duplicates := v_duplicates + 1;
    else
      v_invalid := v_invalid + 1;
    end if;

    v_results := v_results || jsonb_build_object(
      'row', v_idx,
      'request_number', v_number,
      'item_name', v_item,
      'status', v_kind,
      'messages', to_jsonb(v_errors),
      'id', v_new_id
    );
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'total', v_idx,
    'valid', v_idx - v_duplicates - v_invalid,
    'inserted', v_inserted,
    'duplicates', v_duplicates,
    'invalid', v_invalid,
    'rows', v_results
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile & administration
-- ---------------------------------------------------------------------------
create or replace function public.update_own_profile(p_full_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  v_profile := public.require_profile();
  if p_full_name is null or char_length(btrim(p_full_name)) not between 1 and 120 then
    raise exception 'VALIDATION: Name must be between 1 and 120 characters.' using errcode = '22023';
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = v_profile.id;
end;
$$;

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_role public.app_role,
  p_department_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  v_profile := public.require_profile();
  if v_profile.role <> 'admin' then
    raise exception 'FORBIDDEN: Only administrators can change roles and departments.' using errcode = '42501';
  end if;
  if p_user_id = v_profile.id and p_role <> 'admin' then
    raise exception 'VALIDATION: You cannot remove your own administrator role.' using errcode = '22023';
  end if;
  if p_department_id is not null and not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'VALIDATION: Department does not exist.' using errcode = '22023';
  end if;
  update public.profiles set role = p_role, department_id = p_department_id where id = p_user_id;
  if not found then
    raise exception 'NOT_FOUND: User profile not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_upsert_department(
  p_id uuid,
  p_code text,
  p_name text,
  p_is_active boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_id uuid;
begin
  v_profile := public.require_profile();
  if v_profile.role <> 'admin' then
    raise exception 'FORBIDDEN: Only administrators can manage departments.' using errcode = '42501';
  end if;
  if p_code is null or upper(btrim(p_code)) !~ '^[A-Z0-9]{2,10}$' then
    raise exception 'VALIDATION: Department code must be 2-10 letters or digits.' using errcode = '22023';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 80 then
    raise exception 'VALIDATION: Department name must be between 2 and 80 characters.' using errcode = '22023';
  end if;

  begin
    if p_id is null then
      insert into public.departments (code, name, is_active)
      values (upper(btrim(p_code)), btrim(p_name), coalesce(p_is_active, true))
      returning id into v_id;
    else
      update public.departments
         set code = upper(btrim(p_code)), name = btrim(p_name), is_active = coalesce(p_is_active, true)
       where id = p_id
      returning id into v_id;
      if v_id is null then
        raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0002';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE: A department with this code or name already exists.' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create or replace function public.update_app_settings(
  p_organization_name           text,
  p_currency                    text,
  p_allow_self_approval         boolean,
  p_manual_minutes_per_request  integer,
  p_digital_minutes_per_request integer,
  p_manual_cycle_days           numeric,
  p_hourly_staff_cost           numeric
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  v_profile := public.require_profile();
  if v_profile.role <> 'admin' then
    raise exception 'FORBIDDEN: Only administrators can change settings.' using errcode = '42501';
  end if;
  begin
    update public.app_settings
       set organization_name = btrim(p_organization_name),
           currency = upper(btrim(p_currency)),
           allow_self_approval = p_allow_self_approval,
           manual_minutes_per_request = p_manual_minutes_per_request,
           digital_minutes_per_request = p_digital_minutes_per_request,
           manual_cycle_days = p_manual_cycle_days,
           hourly_staff_cost = p_hourly_staff_cost,
           updated_by = v_profile.id
     where id = 1;
  exception when check_violation or not_null_violation then
    raise exception 'VALIDATION: One or more settings are outside the allowed range.' using errcode = '22023';
  end;
end;
$$;
-- =============================================================================
-- FLOWTRACK — privileges and Row Level Security
--
-- * anon: no access to any table or function.
-- * authenticated: SELECT only, filtered by RLS; writes only via the
--   SECURITY DEFINER workflow functions (which enforce authorization).
-- * service_role: used exclusively by local seed scripts, never by the app.
-- =============================================================================

alter table public.departments       enable row level security;
alter table public.profiles          enable row level security;
alter table public.app_settings      enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.approval_actions  enable row level security;
alter table public.audit_logs        enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
revoke all on public.departments, public.profiles, public.app_settings,
              public.purchase_requests, public.approval_actions, public.audit_logs
  from anon, authenticated;

grant select on public.departments, public.profiles, public.app_settings,
                public.purchase_requests, public.approval_actions, public.audit_logs
  to authenticated;

grant all on public.departments, public.profiles, public.app_settings,
             public.purchase_requests, public.approval_actions, public.audit_logs
  to service_role;

revoke all on sequence public.purchase_request_number_seq from anon, authenticated;
grant usage, select on sequence public.purchase_request_number_seq to service_role;

-- ---------------------------------------------------------------------------
-- Policies (SELECT only — there are intentionally no INSERT/UPDATE/DELETE
-- policies for authenticated users)
-- ---------------------------------------------------------------------------

-- Departments are reference data visible to every signed-in user.
create policy "departments readable by signed-in users"
  on public.departments for select to authenticated
  using (true);

-- Profiles act as the internal company directory (name, role, department).
create policy "profiles readable by signed-in users"
  on public.profiles for select to authenticated
  using (true);

create policy "settings readable by signed-in users"
  on public.app_settings for select to authenticated
  using (true);

-- Requests: requester, department manager, or administrator.
create policy "requests visible to requester, department manager, admin"
  on public.purchase_requests for select to authenticated
  using (public.can_view_request(requester_id, department_id));

-- History follows the visibility of its parent request.
create policy "approval history follows request visibility"
  on public.approval_actions for select to authenticated
  using (
    exists (
      select 1 from public.purchase_requests r
       where r.id = approval_actions.request_id
         and public.can_view_request(r.requester_id, r.department_id)
    )
  );

-- Audit logs: administrators see everything; others only entries for
-- requests they are allowed to view.
create policy "audit logs visible to admins or request viewers"
  on public.audit_logs for select to authenticated
  using (
    public.is_admin()
    or (
      entity_type = 'purchase_request'
      and exists (
        select 1 from public.purchase_requests r
         where r.id::text = audit_logs.entity_id
           and public.can_view_request(r.requester_id, r.department_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is callable by anon / PUBLIC.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;

-- Internal helpers: not callable directly by API clients.
revoke execute on function
  public.touch_updated_at(),
  public.enforce_purchase_request_rules(),
  public.prevent_purchase_request_delete(),
  public.record_purchase_request_history(),
  public.write_audit_log(),
  public.prevent_history_mutation(),
  public.handle_new_user(),
  public.next_request_number(),
  public.require_profile(),
  public.validate_request_fields(public.profiles, text, text, integer, numeric, uuid, text, date),
  public.decide_purchase_request(uuid, public.request_status, text)
  from authenticated;

-- RLS helpers + workflow API for signed-in users.
grant execute on function
  public.current_app_role(),
  public.current_department_id(),
  public.is_admin(),
  public.can_view_request(uuid, uuid),
  public.is_valid_status_transition(public.request_status, public.request_status),
  public.create_purchase_request(text, text, integer, numeric, uuid, text, date, boolean),
  public.update_draft_request(uuid, integer, text, text, integer, numeric, uuid, text, date),
  public.submit_purchase_request(uuid),
  public.approve_purchase_request(uuid, text),
  public.reject_purchase_request(uuid, text),
  public.cancel_purchase_request(uuid, text),
  public.import_purchase_requests(jsonb, boolean),
  public.update_own_profile(text),
  public.admin_update_profile(uuid, public.app_role, uuid),
  public.admin_upsert_department(uuid, text, text, boolean),
  public.update_app_settings(text, text, boolean, integer, integer, numeric, numeric)
  to authenticated;

grant execute on all functions in schema public to service_role;

-- Do not let future objects silently inherit broad default grants.
alter default privileges in schema public revoke execute on functions from public, anon;
-- =============================================================================
-- FLOWTRACK — Fictional Company Demo Seed Data
-- Organization: Nusantara Supplies Co. (Demo Data)
-- NOTE: All records, metrics, and financial figures below are fictional sample
-- data created for portfolio demonstration purposes only.
-- =============================================================================

begin;

-- 1. Organization settings & illustrative ROI baseline assumptions
update public.app_settings
   set organization_name           = 'Nusantara Supplies Co. (Demo)',
       currency                    = 'IDR',
       allow_self_approval         = false,
       manual_minutes_per_request  = 95,
       digital_minutes_per_request = 18,
       manual_cycle_days           = 5.00,
       hourly_staff_cost           = 85000.00
 where id = 1;

-- 2. Departments
insert into public.departments (id, code, name, is_active) values
  ('00000000-0000-4000-8000-000000000101', 'OPS',  'Operations & Logistics',       true),
  ('00000000-0000-4000-8000-000000000102', 'IT',   'Information Technology',       true),
  ('00000000-0000-4000-8000-000000000103', 'FIN',  'Finance & Accounting',         true),
  ('00000000-0000-4000-8000-000000000104', 'PROC', 'Procurement & Vendor Mgmt',    true),
  ('00000000-0000-4000-8000-000000000105', 'HR',   'People & Workplace Operations', true)
on conflict (id) do update
  set code = excluded.code,
      name = excluded.name,
      is_active = excluded.is_active;

-- 3. Demo Users (auth.users trigger automatically creates public.profiles rows)
insert into auth.users (id, email, raw_user_meta_data, created_at) values
  ('00000000-0000-4000-8000-000000000201', 'rina.wijaya@nusantara-demo.id',   '{"full_name":"Rina Wijaya"}',   now() - interval '150 days'),
  ('00000000-0000-4000-8000-000000000202', 'dimas.pratama@nusantara-demo.id', '{"full_name":"Dimas Pratama"}', now() - interval '145 days'),
  ('00000000-0000-4000-8000-000000000203', 'siti.rahma@nusantara-demo.id',    '{"full_name":"Siti Rahma"}',    now() - interval '140 days'),
  ('00000000-0000-4000-8000-000000000204', 'budi.santoso@nusantara-demo.id',  '{"full_name":"Budi Santoso"}',  now() - interval '160 days'),
  ('00000000-0000-4000-8000-000000000205', 'hendra.kusuma@nusantara-demo.id', '{"full_name":"Hendra Kusuma"}', now() - interval '160 days'),
  ('00000000-0000-4000-8000-000000000206', 'nadia.putri@nusantara-demo.id',   '{"full_name":"Nadia Putri"}',   now() - interval '170 days')
on conflict (id) do nothing;

-- Assign roles and departments
update public.profiles set role = 'employee', department_id = '00000000-0000-4000-8000-000000000101', full_name = 'Rina Wijaya'   where id = '00000000-0000-4000-8000-000000000201';
update public.profiles set role = 'employee', department_id = '00000000-0000-4000-8000-000000000102', full_name = 'Dimas Pratama' where id = '00000000-0000-4000-8000-000000000202';
update public.profiles set role = 'employee', department_id = '00000000-0000-4000-8000-000000000103', full_name = 'Siti Rahma'    where id = '00000000-0000-4000-8000-000000000203';
update public.profiles set role = 'manager',  department_id = '00000000-0000-4000-8000-000000000101', full_name = 'Budi Santoso'  where id = '00000000-0000-4000-8000-000000000204';
update public.profiles set role = 'manager',  department_id = '00000000-0000-4000-8000-000000000102', full_name = 'Hendra Kusuma' where id = '00000000-0000-4000-8000-000000000205';
update public.profiles set role = 'admin',    department_id = '00000000-0000-4000-8000-000000000103', full_name = 'Nadia Putri'   where id = '00000000-0000-4000-8000-000000000206';

-- 4. Purchase Requests across 5 months (inserted directly with demo_seed source;
--    the AFTER INSERT trigger populates approval_actions & audit_logs automatically)
insert into public.purchase_requests (
  id, request_number, item_name, description, quantity, unit_price,
  department_id, justification, requester_id, required_date, status,
  submitted_at, decided_at, decided_by, decision_comment,
  cancelled_at, cancelled_by, cancel_reason, source, created_at
) values
  -- Month -4 (June 2026)
  (
    '00000000-0000-4000-8000-000000000301', 'PR-2026-00001',
    'Zebra ZD421 Industrial Label Printers',
    'Direct thermal / thermal transfer 203 dpi with Ethernet module for Bekasi warehouse lanes 1-4.',
    4, 6850000.00,
    '00000000-0000-4000-8000-000000000101',
    'Replace legacy printers causing 40-minute daily shipping label bottlenecks on outbound docks.',
    '00000000-0000-4000-8000-000000000201', (current_date - 95), 'approved',
    now() - interval '120 days', now() - interval '119 days 16 hours',
    '00000000-0000-4000-8000-000000000204', 'Approved under Q2 warehouse automation capex budget.',
    null, null, null, 'demo_seed', now() - interval '120 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000302', 'PR-2026-00002',
    'Ubiquiti UniFi 24-Port PoE+ Switch',
    'Managed Layer-2 switch for floor 3 access points and VoIP phones.',
    2, 9200000.00,
    '00000000-0000-4000-8000-000000000102',
    'Network segmentation and PoE capacity expansion for the new operations control room.',
    '00000000-0000-4000-8000-000000000202', (current_date - 88), 'approved',
    now() - interval '112 days', now() - interval '111 days 18 hours',
    '00000000-0000-4000-8000-000000000205', 'Approved — coordinate maintenance window with facilities.',
    null, null, null, 'demo_seed', now() - interval '112 days 3 hours'
  ),

  -- Month -3 (July 2026)
  (
    '00000000-0000-4000-8000-000000000303', 'PR-2026-00003',
    'Heavy-Duty Hydraulic Pallet Jacks (2.5 Ton)',
    'Galvanized steel frame, tandem polyurethane rollers.',
    5, 4750000.00,
    '00000000-0000-4000-8000-000000000101',
    'Increase staging throughput ahead of Q3 seasonal inventory intake.',
    '00000000-0000-4000-8000-000000000201', (current_date - 65), 'approved',
    now() - interval '92 days', now() - interval '91 days 12 hours',
    '00000000-0000-4000-8000-000000000204', 'Approved. Vendor confirmed 5-day delivery SLA.',
    null, null, null, 'demo_seed', now() - interval '92 days 4 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000304', 'PR-2026-00004',
    'Annual Tax E-Faktur Reconciliation Suite License',
    'Multi-entity VAT & withholding tax reconciliation workbench (10 seats).',
    1, 18500000.00,
    '00000000-0000-4000-8000-000000000103',
    'Automates monthly PPN cross-checks and cuts closing reconciliation by 3 days per month.',
    '00000000-0000-4000-8000-000000000203', (current_date - 60), 'approved',
    now() - interval '85 days', now() - interval '84 days 20 hours',
    '00000000-0000-4000-8000-000000000206', 'Approved by Finance Admin after security review.',
    null, null, null, 'demo_seed', now() - interval '85 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000305', 'PR-2026-00005',
    'Executive Lounge Espresso Machine',
    'Commercial dual-boiler espresso station.',
    1, 24000000.00,
    '00000000-0000-4000-8000-000000000101',
    'Upgrade breakroom beverage equipment for client visits.',
    '00000000-0000-4000-8000-000000000201', (current_date - 55), 'rejected',
    now() - interval '80 days', now() - interval '79 days 15 hours',
    '00000000-0000-4000-8000-000000000204', 'Non-essential spend; Operations budget is prioritized for safety and dock equipment.',
    null, null, null, 'demo_seed', now() - interval '80 days 1 hour'
  ),

  -- Month -2 (August 2026)
  (
    '00000000-0000-4000-8000-000000000306', 'PR-2026-00006',
    'ThinkPad L14 Gen 5 Field Engineer Laptops',
    'Ryzen 7 PRO, 32GB RAM, 1TB SSD, LTE modem for site supervisors.',
    3, 17900000.00,
    '00000000-0000-4000-8000-000000000102',
    'Equip three newly onboarded regional inventory auditors with ruggedized laptops.',
    '00000000-0000-4000-8000-000000000202', (current_date - 35), 'approved',
    now() - interval '62 days', now() - interval '61 days 14 hours',
    '00000000-0000-4000-8000-000000000205', 'Approved under standard IT hardware refresh catalog.',
    null, null, null, 'demo_seed', now() - interval '62 days 3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000307', 'PR-2026-00007',
    'Warehouse Safety PPE Kit Replenishment',
    'EN 397 helmets, high-visibility vests, steel-toe boots, and cut-resistant gloves.',
    30, 625000.00,
    '00000000-0000-4000-8000-000000000101',
    'Mandatory semi-annual K3 occupational safety compliance replenishment.',
    '00000000-0000-4000-8000-000000000201', (current_date - 30), 'approved',
    now() - interval '54 days', now() - interval '53 days 19 hours',
    '00000000-0000-4000-8000-000000000204', 'Fast-tracked approval for K3 safety audit compliance.',
    null, null, null, 'demo_seed', now() - interval '54 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000308', 'PR-2026-00008',
    'Vendor Portal SSL Wildcard Certificate (2-Year)',
    'OV wildcard TLS certificate for *.nusantara-demo.id subdomains.',
    1, 7400000.00,
    '00000000-0000-4000-8000-000000000102',
    'Scheduled renewal before existing certificate expires next month.',
    '00000000-0000-4000-8000-000000000202', (current_date - 25), 'cancelled',
    null, null, null, null,
    now() - interval '48 days', '00000000-0000-4000-8000-000000000202',
    'Replaced by automated ACME DNS-01 certificates at zero cost.',
    'demo_seed', now() - interval '49 days'
  ),

  -- Month -1 (September 2026)
  (
    '00000000-0000-4000-8000-000000000309', 'PR-2026-00009',
    'Honeywell Xenon Ultra 2D Barcode Scanners',
    'Cordless area-imaging scanners with charging cradles for receiving bays.',
    8, 3950000.00,
    '00000000-0000-4000-8000-000000000101',
    'Eliminate manual SKU entry errors during inbound supplier receiving.',
    '00000000-0000-4000-8000-000000000201', (current_date - 10), 'approved',
    now() - interval '32 days', now() - interval '31 days 17 hours',
    '00000000-0000-4000-8000-000000000204', 'Approved — strong ROI on receiving accuracy.',
    null, null, null, 'demo_seed', now() - interval '32 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000310', 'PR-2026-00010',
    'Cloud Backup Immutable Object Storage (12 TB Annual)',
    'S3-compatible object lock storage for off-site PostgreSQL WAL and ERP snapshots.',
    12, 1450000.00,
    '00000000-0000-4000-8000-000000000102',
    'Disaster recovery compliance requirement for daily off-site encrypted database backups.',
    '00000000-0000-4000-8000-000000000202', (current_date - 5), 'approved',
    now() - interval '25 days', now() - interval '24 days 16 hours',
    '00000000-0000-4000-8000-000000000205', 'Approved — required by ISO 27001 backup policy.',
    null, null, null, 'demo_seed', now() - interval '25 days 3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000311', 'PR-2026-00011',
    'Unbudgeted Third-Party BI Consultant Retainer',
    'External ad-hoc dashboard consulting package.',
    1, 45000000.00,
    '00000000-0000-4000-8000-000000000102',
    'Outsource custom KPI reporting to external agency.',
    '00000000-0000-4000-8000-000000000202', (current_date + 5), 'rejected',
    now() - interval '21 days', now() - interval '20 days 18 hours',
    '00000000-0000-4000-8000-000000000205', 'Rejected: internal FLOWTRACK analytics already covers operational KPIs without external agency spend.',
    null, null, null, 'demo_seed', now() - interval '21 days 2 hours'
  ),

  -- Current Month (October 2026) — includes active Pending Approvals & Drafts for live demo!
  (
    '00000000-0000-4000-8000-000000000312', 'PR-2026-00012',
    'Digital Platform Scale 500kg with RS-232 Interface',
    'Stainless steel bench scale integrated with dispatch workstation.',
    2, 5600000.00,
    '00000000-0000-4000-8000-000000000101',
    'Automates parcel weight capture at outbound packing stations to prevent carrier surcharges.',
    '00000000-0000-4000-8000-000000000201', (current_date + 12), 'approved',
    now() - interval '10 days', now() - interval '9 days 19 hours',
    '00000000-0000-4000-8000-000000000204', 'Approved. Expect payback within two billing cycles.',
    null, null, null, 'demo_seed', now() - interval '10 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000313', 'PR-2026-00013',
    'Industrial Rack UPS 3000VA Pure Sinewave',
    'APC Smart-UPS 2U rackmount with network management card for warehouse IDF closet.',
    2, 11400000.00,
    '00000000-0000-4000-8000-000000000101',
    'Protect core barcode & WMS switches from grid voltage sags during monsoon season.',
    '00000000-0000-4000-8000-000000000201', (current_date + 14), 'pending_approval',
    now() - interval '2 days', null, null, null,
    null, null, null, 'demo_seed', now() - interval '2 days 3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000314', 'PR-2026-00014',
    'Cold-Chain Temperature Data Loggers (USB + BLE)',
    'Calibrated -30C to +70C multi-use loggers with NIST certificate.',
    20, 485000.00,
    '00000000-0000-4000-8000-000000000101',
    'Required by new pharmaceutical distribution client SLA for refrigerated fleet monitoring.',
    '00000000-0000-4000-8000-000000000201', (current_date + 18), 'pending_approval',
    now() - interval '1 day 6 hours', null, null, null,
    null, null, null, 'demo_seed', now() - interval '1 day 8 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000315', 'PR-2026-00015',
    'Dell UltraSharp 27" USB-C Hub Monitors (U2724DE)',
    'QHD IPS Black panel with integrated 90W power delivery and RJ45.',
    6, 7850000.00,
    '00000000-0000-4000-8000-000000000102',
    'Standard dual-display workstation setup for the systems engineering and NOC team.',
    '00000000-0000-4000-8000-000000000202', (current_date + 21), 'pending_approval',
    now() - interval '18 hours', null, null, null,
    null, null, null, 'demo_seed', now() - interval '20 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000316', 'PR-2026-00016',
    'Automated Stretch-Wrap Turntable Spare Rollers Kit',
    'OEM replacement roller bearings and photo-eye sensor kit.',
    3, 2150000.00,
    '00000000-0000-4000-8000-000000000101',
    'Preventive maintenance stock for packing line #2 before year-end peak volume.',
    '00000000-0000-4000-8000-000000000201', (current_date + 25), 'draft',
    null, null, null, null,
    null, null, null, 'demo_seed', now() - interval '6 hours'
  )
on conflict (id) do nothing;

-- Advance the sequence past the seeded numbers so newly created requests start at PR-2026-00017+
select setval('public.purchase_request_number_seq', 16, true);

commit;
