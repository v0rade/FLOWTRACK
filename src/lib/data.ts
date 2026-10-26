import { cookies } from "next/headers";
import {
  DEFAULT_DEMO_USER_ID,
  DEMO_SESSION_COOKIE,
  isLiveSupabaseConfigured,
} from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withAsUser } from "@/lib/db/embedded-pg";
import type {
  ApprovalAction,
  AppSettings,
  Department,
  Profile,
  PurchaseRequest,
  Role,
} from "@/lib/types";

export interface EnrichedPurchaseRequest extends PurchaseRequest {
  department_code: string;
  department_name: string;
  requester_name: string;
  requester_email: string;
  decided_by_name: string | null;
  cancelled_by_name: string | null;
}

export interface EnrichedApprovalAction extends ApprovalAction {
  actor_name: string | null;
  actor_email: string | null;
  actor_role: Role | null;
}

export interface EnrichedAuditLog {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  entity_type: string;
  entity_id: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  changed_fields: string[];
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

export interface AppSessionContext {
  profile: Profile;
  department: Department | null;
  settings: AppSettings;
  departments: Department[];
  pendingApprovalCount: number;
  isDemoMode: boolean;
}

export interface ImportRowInput {
  request_number?: string | null;
  item_name: string;
  description?: string;
  quantity: string | number;
  unit_price: string;
  department_code: string;
  justification: string;
  required_date: string;
  status?: string;
}

export interface DbImportResult {
  dry_run: boolean;
  total: number;
  valid: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  rows: {
    row: number;
    request_number: string | null;
    item_name: string;
    status: "valid" | "duplicate" | "invalid";
    messages: string[];
    id: string | null;
  }[];
}

const KNOWN_ERROR_PREFIX =
  /^(NOT_AUTHENTICATED|FORBIDDEN|NOT_FOUND|VALIDATION|INVALID_TRANSITION|LOCKED|CONFLICT|DUPLICATE):\s*(.+)$/i;

/** Maps PostgreSQL domain exceptions into clean, user-facing messages. */
export function friendlyDbError(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "Unexpected error");

  const match = KNOWN_ERROR_PREFIX.exec(raw.trim());
  if (match) {
    return match[2];
  }
  if (/permission denied/i.test(raw)) {
    return "You do not have permission to perform this action.";
  }
  return "Unable to complete the operation. Please check your inputs and try again.";
}

export async function getActiveUserId(): Promise<string | null> {
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  }

  const cookieStore = await cookies();
  const cookieVal = cookieStore.get(DEMO_SESSION_COOKIE)?.value;
  if (cookieVal === "signed_out") {
    return null;
  }
  if (cookieVal && /^[0-9a-f-]{36}$/i.test(cookieVal)) {
    return cookieVal;
  }
  return DEFAULT_DEMO_USER_ID;
}

function normalizeMoneyString(val: unknown): string {
  if (typeof val === "number") return val.toFixed(2);
  const str = String(val ?? "0.00");
  if (!str.includes(".")) return `${str}.00`;
  const [w, f] = str.split(".");
  return `${w}.${(f ?? "").padEnd(2, "0").slice(0, 2)}`;
}

function normalizeDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val ?? "").slice(0, 10);
}

function normalizeTimestamp(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

/**
 * Loads the current signed-in user's profile, department, organization settings,
 * active departments, and pending approval badge count.
 */
export async function getAppContext(): Promise<AppSessionContext | null> {
  const userId = await getActiveUserId();
  if (!userId) return null;

  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const [profileRes, deptsRes, settingsRes, pendingRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase.from("departments").select("*").order("code"),
      supabase.from("app_settings").select("*").eq("id", 1).single(),
      supabase
        .from("purchase_requests")
        .select("id, requester_id, department_id", { count: "exact" })
        .eq("status", "pending_approval"),
    ]);

    if (!profileRes.data || !settingsRes.data) return null;
    const profile = profileRes.data as Profile;
    const departments = (deptsRes.data ?? []) as Department[];
    const settings: AppSettings = {
      ...settingsRes.data,
      manual_cycle_days: normalizeMoneyString(settingsRes.data.manual_cycle_days),
      hourly_staff_cost: normalizeMoneyString(settingsRes.data.hourly_staff_cost),
      updated_at: normalizeTimestamp(settingsRes.data.updated_at) ?? new Date().toISOString(),
    };
    const pendingRows = (pendingRes.data ?? []) as {
      id: string;
      requester_id: string;
      department_id: string;
    }[];
    const actionableCount = countActionablePending(profile, pendingRows, settings.allow_self_approval);

    return {
      profile,
      department: departments.find((d) => d.id === profile.department_id) ?? null,
      settings,
      departments,
      pendingApprovalCount: actionableCount,
      isDemoMode: false,
    };
  }

  return withAsUser(userId, async (db) => {
    const profileQ = await db.query<Profile>("select * from public.profiles where id = $1", [userId]);
    const profile = profileQ.rows[0];
    if (!profile) return null;

    const [deptsQ, settingsQ, pendingQ] = await Promise.all([
      db.query<Department>("select id, code, name, is_active from public.departments order by code"),
      db.query<Record<string, unknown>>("select * from public.app_settings where id = 1"),
      db.query<{ id: string; requester_id: string; department_id: string }>(
        "select id, requester_id, department_id from public.purchase_requests where status = 'pending_approval'",
      ),
    ]);

    const s = settingsQ.rows[0];
    const settings: AppSettings = {
      organization_name: String(s.organization_name),
      currency: String(s.currency),
      allow_self_approval: Boolean(s.allow_self_approval),
      manual_minutes_per_request: Number(s.manual_minutes_per_request),
      digital_minutes_per_request: Number(s.digital_minutes_per_request),
      manual_cycle_days: normalizeMoneyString(s.manual_cycle_days),
      hourly_staff_cost: normalizeMoneyString(s.hourly_staff_cost),
      updated_at: normalizeTimestamp(s.updated_at) ?? new Date().toISOString(),
    };

    const actionableCount = countActionablePending(profile, pendingQ.rows, settings.allow_self_approval);

    return {
      profile,
      department: deptsQ.rows.find((d) => d.id === profile.department_id) ?? null,
      settings,
      departments: deptsQ.rows,
      pendingApprovalCount: actionableCount,
      isDemoMode: true,
    };
  });
}

function countActionablePending(
  profile: Profile,
  rows: { id: string; requester_id: string; department_id: string }[],
  allowSelfApproval: boolean,
): number {
  if (profile.role === "employee") {
    return rows.filter((r) => r.requester_id === profile.id).length;
  }
  return rows.filter((r) => {
    if (profile.role === "manager" && r.department_id !== profile.department_id) return false;
    if (!allowSelfApproval && r.requester_id === profile.id) return false;
    return true;
  }).length;
}

/**
 * Lists all purchase requests visible to the current user under RLS, enriched
 * with department and actor names.
 */
export async function listVisibleRequests(): Promise<EnrichedPurchaseRequest[]> {
  const userId = await getActiveUserId();
  if (!userId) return [];

  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const [reqRes, deptRes, profRes] = await Promise.all([
      supabase.from("purchase_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("departments").select("id, code, name"),
      supabase.from("profiles").select("id, full_name, email"),
    ]);

    const deptMap = new Map((deptRes.data ?? []).map((d) => [d.id, d]));
    const profMap = new Map((profRes.data ?? []).map((p) => [p.id, p]));

    return (reqRes.data ?? []).map((r) => {
      const dept = deptMap.get(r.department_id);
      const reqUser = profMap.get(r.requester_id);
      const decUser = r.decided_by ? profMap.get(r.decided_by) : null;
      const canUser = r.cancelled_by ? profMap.get(r.cancelled_by) : null;
      return {
        ...(r as PurchaseRequest),
        unit_price: normalizeMoneyString(r.unit_price),
        total_amount: normalizeMoneyString(r.total_amount),
        required_date: normalizeDateString(r.required_date),
        created_at: normalizeTimestamp(r.created_at) ?? new Date().toISOString(),
        updated_at: normalizeTimestamp(r.updated_at) ?? new Date().toISOString(),
        submitted_at: normalizeTimestamp(r.submitted_at),
        decided_at: normalizeTimestamp(r.decided_at),
        cancelled_at: normalizeTimestamp(r.cancelled_at),
        department_code: dept?.code ?? "—",
        department_name: dept?.name ?? "Unknown",
        requester_name: reqUser?.full_name ?? "Unknown",
        requester_email: reqUser?.email ?? "",
        decided_by_name: decUser?.full_name ?? null,
        cancelled_by_name: canUser?.full_name ?? null,
      };
    });
  }

  return withAsUser(userId, async (db) => {
    const res = await db.query<Record<string, unknown>>(`
      select
        r.*,
        r.unit_price::text as unit_price_text,
        r.total_amount::text as total_amount_text,
        r.required_date::text as required_date_text,
        d.code as department_code,
        d.name as department_name,
        req.full_name as requester_name,
        req.email as requester_email,
        dec.full_name as decided_by_name,
        can.full_name as cancelled_by_name
      from public.purchase_requests r
      join public.departments d on d.id = r.department_id
      join public.profiles req on req.id = r.requester_id
      left join public.profiles dec on dec.id = r.decided_by
      left join public.profiles can on can.id = r.cancelled_by
      order by r.created_at desc
    `);

    return res.rows.map((r) => ({
      id: String(r.id),
      request_number: String(r.request_number),
      item_name: String(r.item_name),
      description: String(r.description ?? ""),
      quantity: Number(r.quantity),
      unit_price: normalizeMoneyString(r.unit_price_text),
      total_amount: normalizeMoneyString(r.total_amount_text),
      department_id: String(r.department_id),
      justification: String(r.justification),
      requester_id: String(r.requester_id),
      required_date: normalizeDateString(r.required_date_text),
      status: r.status as PurchaseRequest["status"],
      submitted_at: normalizeTimestamp(r.submitted_at),
      decided_at: normalizeTimestamp(r.decided_at),
      decided_by: r.decided_by ? String(r.decided_by) : null,
      decision_comment: r.decision_comment ? String(r.decision_comment) : null,
      cancelled_at: normalizeTimestamp(r.cancelled_at),
      cancel_reason: r.cancel_reason ? String(r.cancel_reason) : null,
      source: r.source as PurchaseRequest["source"],
      version: Number(r.version),
      created_at: normalizeTimestamp(r.created_at) ?? new Date().toISOString(),
      updated_at: normalizeTimestamp(r.updated_at) ?? new Date().toISOString(),
      department_code: String(r.department_code),
      department_name: String(r.department_name),
      requester_name: String(r.requester_name),
      requester_email: String(r.requester_email),
      decided_by_name: r.decided_by_name ? String(r.decided_by_name) : null,
      cancelled_by_name: r.cancelled_by_name ? String(r.cancelled_by_name) : null,
    }));
  });
}

/**
 * Fetches a single purchase request (if authorized under RLS) along with its
 * complete approval action timeline and row-level audit trail.
 */
export async function getRequestWithHistory(requestId: string): Promise<{
  request: EnrichedPurchaseRequest;
  actions: EnrichedApprovalAction[];
  audits: EnrichedAuditLog[];
} | null> {
  const userId = await getActiveUserId();
  if (!userId) return null;

  const allVisible = await listVisibleRequests();
  const request = allVisible.find((r) => r.id === requestId);
  if (!request) return null;

  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const [actRes, audRes, profRes] = await Promise.all([
      supabase
        .from("approval_actions")
        .select("*")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true }),
      supabase
        .from("audit_logs")
        .select("*")
        .eq("entity_type", "purchase_request")
        .eq("entity_id", requestId)
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email, role"),
    ]);

    const profMap = new Map((profRes.data ?? []).map((p) => [p.id, p]));
    const actions: EnrichedApprovalAction[] = (actRes.data ?? []).map((a) => {
      const p = a.actor_id ? profMap.get(a.actor_id) : null;
      return {
        ...(a as ApprovalAction),
        created_at: normalizeTimestamp(a.created_at) ?? new Date().toISOString(),
        actor_name: p?.full_name ?? null,
        actor_email: p?.email ?? null,
        actor_role: (p?.role as Role) ?? null,
      };
    });

    const audits: EnrichedAuditLog[] = (audRes.data ?? []).map((l) => {
      const p = l.actor_id ? profMap.get(l.actor_id) : null;
      return {
        id: Number(l.id),
        actor_id: l.actor_id,
        actor_name: p?.full_name ?? "System / Seed",
        actor_email: p?.email ?? null,
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        operation: l.operation,
        changed_fields: l.changed_fields ?? [],
        old_data: l.old_data,
        new_data: l.new_data,
        created_at: normalizeTimestamp(l.created_at) ?? new Date().toISOString(),
      };
    });

    return { request, actions, audits };
  }

  return withAsUser(userId, async (db) => {
    const [actQ, audQ] = await Promise.all([
      db.query<Record<string, unknown>>(
        `
        select a.*, p.full_name as actor_name, p.email as actor_email, p.role as actor_role
        from public.approval_actions a
        left join public.profiles p on p.id = a.actor_id
        where a.request_id = $1
        order by a.created_at asc, a.id asc
      `,
        [requestId],
      ),
      db.query<Record<string, unknown>>(
        `
        select l.*, p.full_name as actor_name, p.email as actor_email
        from public.audit_logs l
        left join public.profiles p on p.id = l.actor_id
        where l.entity_type = 'purchase_request' and l.entity_id = $1
        order by l.created_at desc, l.id desc
      `,
        [requestId],
      ),
    ]);

    const actions: EnrichedApprovalAction[] = actQ.rows.map((a) => ({
      id: Number(a.id),
      request_id: String(a.request_id),
      action: a.action as ApprovalAction["action"],
      from_status: (a.from_status as ApprovalAction["from_status"]) ?? null,
      to_status: a.to_status as ApprovalAction["to_status"],
      actor_id: a.actor_id ? String(a.actor_id) : null,
      comment: a.comment ? String(a.comment) : null,
      created_at: normalizeTimestamp(a.created_at) ?? new Date().toISOString(),
      actor_name: a.actor_name ? String(a.actor_name) : null,
      actor_email: a.actor_email ? String(a.actor_email) : null,
      actor_role: (a.actor_role as Role) ?? null,
    }));

    const audits: EnrichedAuditLog[] = audQ.rows.map((l) => ({
      id: Number(l.id),
      actor_id: l.actor_id ? String(l.actor_id) : null,
      actor_name: l.actor_name ? String(l.actor_name) : "System / Seed",
      actor_email: l.actor_email ? String(l.actor_email) : null,
      entity_type: String(l.entity_type),
      entity_id: String(l.entity_id),
      operation: l.operation as EnrichedAuditLog["operation"],
      changed_fields: Array.isArray(l.changed_fields) ? (l.changed_fields as string[]) : [],
      old_data: (l.old_data as Record<string, unknown>) ?? null,
      new_data: (l.new_data as Record<string, unknown>) ?? null,
      created_at: normalizeTimestamp(l.created_at) ?? new Date().toISOString(),
    }));

    return { request, actions, audits };
  });
}

/** Recent workflow activity feed for the Overview and Approvals pages. */
export async function listRecentActivity(limit = 10): Promise<
  (EnrichedApprovalAction & {
    request_number: string;
    item_name: string;
    department_code: string;
  })[]
> {
  const userId = await getActiveUserId();
  if (!userId) return [];

  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const [actRes, reqRes, profRes, deptRes] = await Promise.all([
      supabase
        .from("approval_actions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase.from("purchase_requests").select("id, request_number, item_name, department_id"),
      supabase.from("profiles").select("id, full_name, email, role"),
      supabase.from("departments").select("id, code"),
    ]);

    const reqMap = new Map((reqRes.data ?? []).map((r) => [r.id, r]));
    const profMap = new Map((profRes.data ?? []).map((p) => [p.id, p]));
    const deptMap = new Map((deptRes.data ?? []).map((d) => [d.id, d.code]));

    return (actRes.data ?? []).map((a) => {
      const req = reqMap.get(a.request_id);
      const p = a.actor_id ? profMap.get(a.actor_id) : null;
      return {
        ...(a as ApprovalAction),
        created_at: normalizeTimestamp(a.created_at) ?? new Date().toISOString(),
        actor_name: p?.full_name ?? "System",
        actor_email: p?.email ?? null,
        actor_role: (p?.role as Role) ?? null,
        request_number: req?.request_number ?? "—",
        item_name: req?.item_name ?? "Purchase Request",
        department_code: (req && deptMap.get(req.department_id)) ?? "—",
      };
    });
  }

  return withAsUser(userId, async (db) => {
    const res = await db.query<Record<string, unknown>>(
      `
      select
        a.*,
        p.full_name as actor_name,
        p.email as actor_email,
        p.role as actor_role,
        r.request_number,
        r.item_name,
        d.code as department_code
      from public.approval_actions a
      join public.purchase_requests r on r.id = a.request_id
      join public.departments d on d.id = r.department_id
      left join public.profiles p on p.id = a.actor_id
      order by a.created_at desc, a.id desc
      limit $1
    `,
      [limit],
    );

    return res.rows.map((a) => ({
      id: Number(a.id),
      request_id: String(a.request_id),
      action: a.action as ApprovalAction["action"],
      from_status: (a.from_status as ApprovalAction["from_status"]) ?? null,
      to_status: a.to_status as ApprovalAction["to_status"],
      actor_id: a.actor_id ? String(a.actor_id) : null,
      comment: a.comment ? String(a.comment) : null,
      created_at: normalizeTimestamp(a.created_at) ?? new Date().toISOString(),
      actor_name: a.actor_name ? String(a.actor_name) : "System",
      actor_email: a.actor_email ? String(a.actor_email) : null,
      actor_role: (a.actor_role as Role) ?? null,
      request_number: String(a.request_number),
      item_name: String(a.item_name),
      department_code: String(a.department_code),
    }));
  });
}

export async function listProfilesDirectory(): Promise<
  (Profile & { department_code: string | null; department_name: string | null })[]
> {
  const userId = await getActiveUserId();
  if (!userId) return [];

  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const [profRes, deptRes] = await Promise.all([
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("departments").select("id, code, name"),
    ]);
    const deptMap = new Map((deptRes.data ?? []).map((d) => [d.id, d]));
    return (profRes.data ?? []).map((p) => {
      const d = p.department_id ? deptMap.get(p.department_id) : null;
      return {
        ...(p as Profile),
        department_code: d?.code ?? null,
        department_name: d?.name ?? null,
      };
    });
  }

  return withAsUser(userId, async (db) => {
    const res = await db.query<Record<string, unknown>>(`
      select p.*, d.code as department_code, d.name as department_name
      from public.profiles p
      left join public.departments d on d.id = p.department_id
      order by p.full_name asc
    `);
    return res.rows.map((p) => ({
      id: String(p.id),
      email: String(p.email),
      full_name: String(p.full_name),
      role: p.role as Role,
      department_id: p.department_id ? String(p.department_id) : null,
      department_code: p.department_code ? String(p.department_code) : null,
      department_name: p.department_name ? String(p.department_name) : null,
    }));
  });
}

export async function listAuditLogs(limit = 40): Promise<EnrichedAuditLog[]> {
  const userId = await getActiveUserId();
  if (!userId) return [];

  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const [audRes, profRes] = await Promise.all([
      supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(limit),
      supabase.from("profiles").select("id, full_name, email"),
    ]);
    const profMap = new Map((profRes.data ?? []).map((p) => [p.id, p]));
    return (audRes.data ?? []).map((l) => {
      const p = l.actor_id ? profMap.get(l.actor_id) : null;
      return {
        id: Number(l.id),
        actor_id: l.actor_id,
        actor_name: p?.full_name ?? "System / Seed",
        actor_email: p?.email ?? null,
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        operation: l.operation,
        changed_fields: l.changed_fields ?? [],
        old_data: l.old_data,
        new_data: l.new_data,
        created_at: normalizeTimestamp(l.created_at) ?? new Date().toISOString(),
      };
    });
  }

  return withAsUser(userId, async (db) => {
    const res = await db.query<Record<string, unknown>>(
      `
      select l.*, p.full_name as actor_name, p.email as actor_email
      from public.audit_logs l
      left join public.profiles p on p.id = l.actor_id
      order by l.created_at desc, l.id desc
      limit $1
    `,
      [limit],
    );
    return res.rows.map((l) => ({
      id: Number(l.id),
      actor_id: l.actor_id ? String(l.actor_id) : null,
      actor_name: l.actor_name ? String(l.actor_name) : "System / Seed",
      actor_email: l.actor_email ? String(l.actor_email) : null,
      entity_type: String(l.entity_type),
      entity_id: String(l.entity_id),
      operation: l.operation as EnrichedAuditLog["operation"],
      changed_fields: Array.isArray(l.changed_fields) ? (l.changed_fields as string[]) : [],
      old_data: (l.old_data as Record<string, unknown>) ?? null,
      new_data: (l.new_data as Record<string, unknown>) ?? null,
      created_at: normalizeTimestamp(l.created_at) ?? new Date().toISOString(),
    }));
  });
}

// =============================================================================
// Database RPC Mutations (Transactional & Server-Authorized)
// =============================================================================

export async function dbCreatePurchaseRequest(params: {
  item_name: string;
  description: string;
  quantity: number;
  unit_price: string;
  department_id: string;
  justification: string;
  required_date: string;
  submit: boolean;
}): Promise<string> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_purchase_request", {
      p_item_name: params.item_name,
      p_description: params.description,
      p_quantity: params.quantity,
      p_unit_price: params.unit_price,
      p_department_id: params.department_id,
      p_justification: params.justification,
      p_required_date: params.required_date,
      p_submit: params.submit,
    });
    if (error) throw error;
    return String(data);
  }

  return withAsUser(userId, async (db) => {
    const res = await db.query<{ id: string }>(
      `select public.create_purchase_request($1, $2, $3, $4::numeric, $5::uuid, $6, $7::date, $8) as id`,
      [
        params.item_name,
        params.description,
        params.quantity,
        params.unit_price,
        params.department_id,
        params.justification,
        params.required_date,
        params.submit,
      ],
    );
    return res.rows[0].id;
  });
}

export async function dbUpdateDraftRequest(params: {
  id: string;
  expected_version: number;
  item_name: string;
  description: string;
  quantity: number;
  unit_price: string;
  department_id: string;
  justification: string;
  required_date: string;
}): Promise<number> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("update_draft_request", {
      p_request_id: params.id,
      p_expected_version: params.expected_version,
      p_item_name: params.item_name,
      p_description: params.description,
      p_quantity: params.quantity,
      p_unit_price: params.unit_price,
      p_department_id: params.department_id,
      p_justification: params.justification,
      p_required_date: params.required_date,
    });
    if (error) throw error;
    return Number(data);
  }

  return withAsUser(userId, async (db) => {
    const res = await db.query<{ v: number }>(
      `select public.update_draft_request($1::uuid, $2, $3, $4, $5, $6::numeric, $7::uuid, $8, $9::date) as v`,
      [
        params.id,
        params.expected_version,
        params.item_name,
        params.description,
        params.quantity,
        params.unit_price,
        params.department_id,
        params.justification,
        params.required_date,
      ],
    );
    return res.rows[0].v;
  });
}

export async function dbSubmitPurchaseRequest(requestId: string): Promise<void> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("submit_purchase_request", {
      p_request_id: requestId,
    });
    if (error) throw error;
    return;
  }

  await withAsUser(userId, async (db) => {
    await db.query("select public.submit_purchase_request($1::uuid)", [requestId]);
  });
}

export async function dbApprovePurchaseRequest(requestId: string, comment?: string): Promise<void> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("approve_purchase_request", {
      p_request_id: requestId,
      p_comment: comment ?? null,
    });
    if (error) throw error;
    return;
  }

  await withAsUser(userId, async (db) => {
    await db.query("select public.approve_purchase_request($1::uuid, $2)", [requestId, comment ?? null]);
  });
}

export async function dbRejectPurchaseRequest(requestId: string, reason: string): Promise<void> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("reject_purchase_request", {
      p_request_id: requestId,
      p_reason: reason,
    });
    if (error) throw error;
    return;
  }

  await withAsUser(userId, async (db) => {
    await db.query("select public.reject_purchase_request($1::uuid, $2)", [requestId, reason]);
  });
}

export async function dbCancelPurchaseRequest(requestId: string, reason?: string): Promise<void> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("cancel_purchase_request", {
      p_request_id: requestId,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    return;
  }

  await withAsUser(userId, async (db) => {
    await db.query("select public.cancel_purchase_request($1::uuid, $2)", [requestId, reason ?? null]);
  });
}

export async function dbImportPurchaseRequests(
  rows: ImportRowInput[],
  dryRun: boolean,
): Promise<DbImportResult> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("import_purchase_requests", {
      p_rows: rows,
      p_dry_run: dryRun,
    });
    if (error) throw error;
    return data as DbImportResult;
  }

  return withAsUser(userId, async (db) => {
    const res = await db.query<{ result: DbImportResult }>(
      "select public.import_purchase_requests($1::jsonb, $2) as result",
      [JSON.stringify(rows), dryRun],
    );
    return res.rows[0].result;
  });
}

export async function dbUpdateOwnProfile(fullName: string): Promise<void> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("update_own_profile", { p_full_name: fullName });
    if (error) throw error;
    return;
  }

  await withAsUser(userId, async (db) => {
    await db.query("select public.update_own_profile($1)", [fullName]);
  });
}

export async function dbAdminUpdateProfile(params: {
  user_id: string;
  role: Role;
  department_id: string | null;
}): Promise<void> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("admin_update_profile", {
      p_user_id: params.user_id,
      p_role: params.role,
      p_department_id: params.department_id,
    });
    if (error) throw error;
    return;
  }

  await withAsUser(userId, async (db) => {
    await db.query("select public.admin_update_profile($1::uuid, $2::public.app_role, $3::uuid)", [
      params.user_id,
      params.role,
      params.department_id,
    ]);
  });
}

export async function dbAdminUpsertDepartment(params: {
  id: string | null;
  code: string;
  name: string;
  is_active: boolean;
}): Promise<string> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("admin_upsert_department", {
      p_id: params.id,
      p_code: params.code,
      p_name: params.name,
      p_is_active: params.is_active,
    });
    if (error) throw error;
    return String(data);
  }

  return withAsUser(userId, async (db) => {
    const res = await db.query<{ id: string }>(
      "select public.admin_upsert_department($1::uuid, $2, $3, $4) as id",
      [params.id, params.code, params.name, params.is_active],
    );
    return res.rows[0].id;
  });
}

export async function dbUpdateAppSettings(params: {
  organization_name: string;
  currency: string;
  allow_self_approval: boolean;
  manual_minutes_per_request: number;
  digital_minutes_per_request: number;
  manual_cycle_days: number;
  hourly_staff_cost: string;
}): Promise<void> {
  const userId = await getActiveUserId();
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("update_app_settings", {
      p_organization_name: params.organization_name,
      p_currency: params.currency,
      p_allow_self_approval: params.allow_self_approval,
      p_manual_minutes_per_request: params.manual_minutes_per_request,
      p_digital_minutes_per_request: params.digital_minutes_per_request,
      p_manual_cycle_days: params.manual_cycle_days,
      p_hourly_staff_cost: params.hourly_staff_cost,
    });
    if (error) throw error;
    return;
  }

  await withAsUser(userId, async (db) => {
    await db.query(
      "select public.update_app_settings($1, $2, $3, $4, $5, $6::numeric, $7::numeric)",
      [
        params.organization_name,
        params.currency,
        params.allow_self_approval,
        params.manual_minutes_per_request,
        params.digital_minutes_per_request,
        params.manual_cycle_days,
        params.hourly_staff_cost,
      ],
    );
  });
}
