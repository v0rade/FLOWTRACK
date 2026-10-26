import type { Profile, RequestStatus, Role } from "./types";

/**
 * Client/server mirror of the workflow rules enforced in PostgreSQL
 * (see supabase/migrations/*_workflow.sql). The database remains the source
 * of truth; these helpers drive UI affordances and early, friendly errors.
 */

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Administrator",
};

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: [],
  rejected: [],
  cancelled: [],
};

export function isValidTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: RequestStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!isValidTransition(from, to)) {
    throw new Error(`INVALID_TRANSITION: Cannot move a request from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.`);
  }
}

type Actor = Pick<Profile, "id" | "role" | "department_id">;
type RequestRef = { requester_id: string; department_id: string; status: RequestStatus };

export function canViewRequest(actor: Actor, request: Pick<RequestRef, "requester_id" | "department_id">): boolean {
  return (
    actor.id === request.requester_id ||
    actor.role === "admin" ||
    (actor.role === "manager" && actor.department_id === request.department_id)
  );
}

export function canEditDraft(actor: Actor, request: RequestRef): boolean {
  return request.status === "draft" && actor.id === request.requester_id;
}

export function canSubmit(actor: Actor, request: RequestRef): boolean {
  return request.status === "draft" && actor.id === request.requester_id;
}

export function canCancel(actor: Actor, request: RequestRef): boolean {
  return (
    (request.status === "draft" || request.status === "pending_approval") &&
    (actor.id === request.requester_id || actor.role === "admin")
  );
}

export type DecisionCheck = { allowed: true } | { allowed: false; reason: string };

/** Can `actor` approve/reject `request` under the configured business rules? */
export function checkDecisionPermission(
  actor: Actor,
  request: RequestRef,
  rules: { allowSelfApproval: boolean },
): DecisionCheck {
  if (actor.role !== "manager" && actor.role !== "admin") {
    return { allowed: false, reason: "Only managers and administrators can approve or reject requests." };
  }
  if (actor.role === "manager" && actor.department_id !== request.department_id) {
    return { allowed: false, reason: "Managers can only decide on requests from their own department." };
  }
  if (actor.id === request.requester_id && !rules.allowSelfApproval) {
    return { allowed: false, reason: "You cannot approve or reject your own request (self-approval is disabled)." };
  }
  if (request.status !== "pending_approval") {
    return { allowed: false, reason: `This request is ${STATUS_LABELS[request.status].toLowerCase()} and cannot be decided.` };
  }
  return { allowed: true };
}

export function canDecide(actor: Actor, request: RequestRef, rules: { allowSelfApproval: boolean }): boolean {
  return checkDecisionPermission(actor, request, rules).allowed;
}

export function canManageSettings(actor: Pick<Profile, "role">): boolean {
  return actor.role === "admin";
}

export function canImport(actor: Pick<Profile, "role" | "department_id">): boolean {
  return actor.role === "admin" || actor.department_id !== null;
}
