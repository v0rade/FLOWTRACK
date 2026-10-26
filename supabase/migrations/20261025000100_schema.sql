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
