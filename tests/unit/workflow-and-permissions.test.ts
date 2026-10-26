import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canCancel,
  canDecide,
  canEditDraft,
  canManageSettings,
  canSubmit,
  canViewRequest,
  checkDecisionPermission,
  isTerminal,
  isValidTransition,
} from "@/lib/workflow";

const OPS = "00000000-0000-4000-8000-0000000000d1";
const FIN = "00000000-0000-4000-8000-0000000000d2";

const employee = { id: "u-emp", role: "employee" as const, department_id: OPS };
const otherEmployee = { id: "u-emp-2", role: "employee" as const, department_id: OPS };
const opsManager = { id: "u-mgr-ops", role: "manager" as const, department_id: OPS };
const finManager = { id: "u-mgr-fin", role: "manager" as const, department_id: FIN };
const admin = { id: "u-admin", role: "admin" as const, department_id: FIN };

describe("status transition rules", () => {
  it("allows only valid transitions", () => {
    expect(isValidTransition("draft", "pending_approval")).toBe(true);
    expect(isValidTransition("draft", "cancelled")).toBe(true);
    expect(isValidTransition("pending_approval", "approved")).toBe(true);
    expect(isValidTransition("pending_approval", "rejected")).toBe(true);
    expect(isValidTransition("pending_approval", "cancelled")).toBe(true);
  });

  it("blocks invalid transitions and marks terminal statuses", () => {
    expect(isValidTransition("draft", "approved")).toBe(false);
    expect(isValidTransition("draft", "rejected")).toBe(false);
    expect(isValidTransition("approved", "rejected")).toBe(false);
    expect(isValidTransition("approved", "cancelled")).toBe(false);
    expect(isValidTransition("rejected", "pending_approval")).toBe(false);
    expect(isValidTransition("cancelled", "draft")).toBe(false);

    expect(isTerminal("approved")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("draft")).toBe(false);
    expect(() => assertTransition("approved", "draft")).toThrow(/INVALID_TRANSITION/);
  });
});

describe("role-based permission checks", () => {
  const pendingOpsReq = {
    requester_id: employee.id,
    department_id: OPS,
    status: "pending_approval" as const,
  };
  const draftOpsReq = {
    requester_id: employee.id,
    department_id: OPS,
    status: "draft" as const,
  };

  it("enforces cross-user visibility rules", () => {
    expect(canViewRequest(employee, pendingOpsReq)).toBe(true);
    expect(canViewRequest(otherEmployee, pendingOpsReq)).toBe(false);
    expect(canViewRequest(opsManager, pendingOpsReq)).toBe(true);
    expect(canViewRequest(finManager, pendingOpsReq)).toBe(false);
    expect(canViewRequest(admin, pendingOpsReq)).toBe(true);
  });

  it("restricts draft edits and submission to the requester on draft rows", () => {
    expect(canEditDraft(employee, draftOpsReq)).toBe(true);
    expect(canEditDraft(opsManager, draftOpsReq)).toBe(false);
    expect(canEditDraft(employee, pendingOpsReq)).toBe(false);

    expect(canSubmit(employee, draftOpsReq)).toBe(true);
    expect(canSubmit(employee, pendingOpsReq)).toBe(false);
  });

  it("allows only department managers or admins to decide pending requests", () => {
    expect(canDecide(employee, pendingOpsReq, { allowSelfApproval: false })).toBe(false);
    expect(canDecide(finManager, pendingOpsReq, { allowSelfApproval: false })).toBe(false);
    expect(canDecide(opsManager, pendingOpsReq, { allowSelfApproval: false })).toBe(true);
    expect(canDecide(admin, pendingOpsReq, { allowSelfApproval: false })).toBe(true);
  });

  it("blocks self-approval unless allowSelfApproval is enabled", () => {
    const mgrOwnReq = {
      requester_id: opsManager.id,
      department_id: OPS,
      status: "pending_approval" as const,
    };
    const denied = checkDecisionPermission(opsManager, mgrOwnReq, { allowSelfApproval: false });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toMatch(/self-approval is disabled/i);
    }

    const allowed = checkDecisionPermission(opsManager, mgrOwnReq, { allowSelfApproval: true });
    expect(allowed.allowed).toBe(true);
  });

  it("allows cancellation only for requester or admin before a decision", () => {
    expect(canCancel(employee, pendingOpsReq)).toBe(true);
    expect(canCancel(admin, pendingOpsReq)).toBe(true);
    expect(canCancel(opsManager, pendingOpsReq)).toBe(false);
    expect(canCancel(employee, { ...pendingOpsReq, status: "approved" })).toBe(false);
    expect(canManageSettings(admin)).toBe(true);
    expect(canManageSettings(opsManager)).toBe(false);
  });
});
