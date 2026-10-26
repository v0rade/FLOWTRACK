export const ROLES = ["employee", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const REQUEST_STATUSES = ["draft", "pending_approval", "approved", "rejected", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type ApprovalActionType = "created" | "submitted" | "approved" | "rejected" | "cancelled";

export interface Department {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  department_id: string | null;
}

export interface AppSettings {
  organization_name: string;
  currency: string;
  allow_self_approval: boolean;
  manual_minutes_per_request: number;
  digital_minutes_per_request: number;
  manual_cycle_days: string;
  hourly_staff_cost: string;
  updated_at: string;
}

/** Purchase request as read from the database (money columns cast to text). */
export interface PurchaseRequest {
  id: string;
  request_number: string;
  item_name: string;
  description: string;
  quantity: number;
  unit_price: string;
  total_amount: string;
  department_id: string;
  justification: string;
  requester_id: string;
  required_date: string;
  status: RequestStatus;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_comment: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  source: "web" | "csv_import" | "demo_seed";
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ApprovalAction {
  id: number;
  request_id: string;
  action: ApprovalActionType;
  from_status: RequestStatus | null;
  to_status: RequestStatus;
  actor_id: string | null;
  comment: string | null;
  created_at: string;
}

/** Shape used by analytics (subset of PurchaseRequest). */
export interface AnalyticsRecord {
  status: RequestStatus;
  department_id: string;
  total_amount: string;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
