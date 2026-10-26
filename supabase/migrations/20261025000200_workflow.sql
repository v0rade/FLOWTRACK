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
