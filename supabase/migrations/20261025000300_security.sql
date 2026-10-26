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
