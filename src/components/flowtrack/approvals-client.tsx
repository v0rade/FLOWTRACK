"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CheckSquare,
  Clock,
  Eye,
  Loader2,
  Lock,
  Search,
  ShieldAlert,
  UserCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "./status-badge";
import { RequestDetailSheet } from "./request-detail-sheet";
import { formatMoney } from "@/lib/money";
import { checkDecisionPermission } from "@/lib/workflow";
import {
  approvePurchaseRequestAction,
  rejectPurchaseRequestAction,
  switchDemoPersonaAction,
} from "@/app/actions";
import { DEMO_PERSONAS } from "@/lib/supabase/config";
import type {
  AppSessionContext,
  EnrichedApprovalAction,
  EnrichedPurchaseRequest,
} from "@/lib/data";

export function ApprovalsClient({
  context,
  requests,
  recentActivity,
}: {
  context: AppSessionContext;
  requests: EnrichedPurchaseRequest[];
  recentActivity: (EnrichedApprovalAction & {
    request_number: string;
    item_name: string;
    department_code: string;
  })[];
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"pending" | "decided">("pending");
  const [search, setSearch] = React.useState("");
  const [departmentFilter, setDepartmentFilter] = React.useState("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Decision modal state
  const [decisionTarget, setDecisionTarget] = React.useState<{
    request: EnrichedPurchaseRequest;
    mode: "approve" | "reject";
  } | null>(null);
  const [comment, setComment] = React.useState("");
  const [modalError, setModalError] = React.useState<string | null>(null);
  const [isMutating, startTransition] = React.useTransition();

  const selectedRequest = React.useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  const pendingList = React.useMemo(
    () => requests.filter((r) => r.status === "pending_approval"),
    [requests],
  );

  const decidedList = React.useMemo(
    () => requests.filter((r) => r.status === "approved" || r.status === "rejected"),
    [requests],
  );

  const filteredList = React.useMemo(() => {
    const source = tab === "pending" ? pendingList : decidedList;
    const q = search.trim().toLowerCase();
    return source.filter((r) => {
      if (departmentFilter !== "all" && r.department_id !== departmentFilter) return false;
      if (q) {
        const hay = `${r.request_number} ${r.item_name} ${r.requester_name} ${r.department_code} ${r.justification}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tab, pendingList, decidedList, search, departmentFilter]);

  function openDecisionModal(req: EnrichedPurchaseRequest, mode: "approve" | "reject") {
    setComment("");
    setModalError(null);
    setDecisionTarget({ request: req, mode });
  }

  function handleConfirmDecision() {
    if (!decisionTarget) return;
    const { request, mode } = decisionTarget;
    if (mode === "reject" && comment.trim().length < 5) {
      setModalError("A rejection reason of at least 5 characters is required.");
      return;
    }
    setModalError(null);

    startTransition(async () => {
      const res =
        mode === "approve"
          ? await approvePurchaseRequestAction({
              id: request.id,
              comment: comment.trim() || undefined,
            })
          : await rejectPurchaseRequestAction({
              id: request.id,
              reason: comment.trim(),
            });

      if (!res.ok) {
        setModalError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? `Request ${mode}d`);
      setDecisionTarget(null);
      router.refresh();
    });
  }

  function handleSwitchToOpsManager() {
    const budi = DEMO_PERSONAS[1]; // Budi Santoso (Manager · OPS)
    startTransition(async () => {
      const res = await switchDemoPersonaAction(budi.id);
      if (res.ok) {
        toast.success(res.message ?? "Switched to Operations Manager");
        router.refresh();
      }
    });
  }

  const currency = context.settings.currency;
  const isApproverRole =
    context.profile.role === "manager" || context.profile.role === "admin";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Approval Workflow Queue
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Server-authorized approval decisions backed by PostgreSQL row locks (<code className="font-mono">SELECT ... FOR UPDATE</code>) and immutable audit trails.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700">
            Self-Approval Rule:{" "}
            <strong
              className={
                context.settings.allow_self_approval
                  ? "text-amber-700"
                  : "text-teal-700"
              }
            >
              {context.settings.allow_self_approval ? "Permitted" : "Blocked (Strict)"}
            </strong>
          </span>
        </div>
      </div>

      {/* Role-aware guidance banner */}
      {!isApproverRole && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-950">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                You are signed in as an Employee ({context.profile.full_name})
              </p>
              <p className="text-amber-800">
                Employees can track their submitted requests here, but PostgreSQL security functions block employees from approving or rejecting requests.
              </p>
            </div>
          </div>
          {context.isDemoMode && (
            <Button
              size="sm"
              variant="outline"
              disabled={isMutating}
              onClick={handleSwitchToOpsManager}
              className="shrink-0 gap-1.5 border-amber-300 bg-white text-amber-950 hover:bg-amber-100"
            >
              <UserCheck className="size-3.5 text-teal-600" />
              Switch to Budi Santoso (Manager · OPS)
            </Button>
          )}
        </div>
      )}

      {/* Tabs + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("pending")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
              tab === "pending"
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Clock className="size-3.5" />
            Pending Approval
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                tab === "pending"
                  ? "bg-amber-400 text-slate-950"
                  : "bg-amber-50 text-amber-800"
              }`}
            >
              {pendingList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab("decided")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
              tab === "decided"
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <CheckSquare className="size-3.5" />
            Decided History (Locked)
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                tab === "decided"
                  ? "bg-teal-400 text-slate-950"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {decidedList.length}
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-60">
            <Search className="size-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <Input
              placeholder="Search queue..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <select
            aria-label="Filter department"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800"
          >
            <option value="all">All Departments</option>
            {context.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Queue Cards / Table */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 space-y-3">
          {filteredList.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
              <CheckCircle2 className="size-8 text-teal-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-900">
                {tab === "pending"
                  ? "No pending approvals in this view"
                  : "No decided requests match your filter"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {tab === "pending"
                  ? "All submitted purchase requests within your authorization scope have been processed."
                  : "Try clearing the search query or switching departments."}
              </p>
            </div>
          ) : (
            filteredList.map((req) => {
              const perm = checkDecisionPermission(context.profile, req, {
                allowSelfApproval: context.settings.allow_self_approval,
              });

              return (
                <div
                  key={req.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-slate-300 transition-colors space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded px-2 py-0.5">
                          {req.request_number}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                          {req.department_code} — {req.department_name}
                        </span>
                        <StatusBadge status={req.status} />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">
                        {req.item_name}
                      </h3>
                    </div>

                    <div className="text-right">
                      <p className="text-[11px] text-slate-400">Server Calculated Total</p>
                      <p className="font-mono text-base font-bold text-slate-900 tabular-nums">
                        {formatMoney(req.total_amount, currency)}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">
                        {req.quantity} × {formatMoney(req.unit_price, currency)}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 bg-slate-50/80 border border-slate-100 rounded-lg px-3 py-2">
                    <strong className="text-slate-700">Justification:</strong> {req.justification}
                  </p>

                  {req.decision_comment && (
                    <div
                      className={`rounded-lg px-3 py-2 text-xs border ${
                        req.status === "rejected"
                          ? "bg-rose-50/70 border-rose-200 text-rose-900"
                          : "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                      }`}
                    >
                      <span className="font-semibold">
                        {req.status === "rejected" ? "Rejection Reason" : "Approval Note"} (by{" "}
                        {req.decided_by_name ?? "Manager"}):
                      </span>{" "}
                      {req.decision_comment}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-xs">
                    <div className="text-slate-500">
                      Requester: <strong className="text-slate-800">{req.requester_name}</strong> ·
                      Submitted:{" "}
                      <span className="font-mono">
                        {req.submitted_at ? req.submitted_at.slice(0, 10) : "—"}
                      </span>{" "}
                      · Needed: <span className="font-mono">{req.required_date}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setSelectedId(req.id)}
                        className="gap-1"
                      >
                        <Eye className="size-3.5" />
                        Inspect & Audit
                      </Button>

                      {req.status === "pending_approval" ? (
                        perm.allowed ? (
                          <>
                            <Button
                              size="xs"
                              onClick={() => openDecisionModal(req, "approve")}
                              disabled={isMutating}
                              className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              <CheckCircle2 className="size-3.5" />
                              Approve
                            </Button>
                            <Button
                              variant="destructive"
                              size="xs"
                              onClick={() => openDecisionModal(req, "reject")}
                              disabled={isMutating}
                              className="gap-1"
                            >
                              <XCircle className="size-3.5" />
                              Reject
                            </Button>
                          </>
                        ) : (
                          <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            {perm.reason}
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <Lock className="size-3" /> Locked
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right column: Audit & Decision Log */}
        <div className="xl:col-span-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Recent Approval Decisions & Transitions
            </h3>
            <p className="text-xs text-slate-500">
              Every state transition is atomically recorded in <code className="font-mono">approval_actions</code> with actor and timestamp.
            </p>
            <div className="divide-y divide-slate-100">
              {recentActivity.slice(0, 8).map((act) => (
                <div
                  key={act.id}
                  onClick={() => setSelectedId(act.request_id)}
                  className="py-2.5 text-xs cursor-pointer hover:bg-slate-50/80 px-1 rounded transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-teal-700">
                      {act.request_number}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {new Date(act.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="font-medium text-slate-800 truncate">{act.item_name}</p>
                  <p className="text-[11px] text-slate-500">
                    <strong>{act.actor_name}</strong> →{" "}
                    <span className="font-mono uppercase text-[10px] font-semibold">
                      {act.action}
                    </span>
                  </p>
                  {act.comment && (
                    <p className="mt-1 text-[11px] italic text-slate-600 line-clamp-2">
                      “{act.comment}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Approve / Reject Confirmation Modal */}
      <Dialog
        open={Boolean(decisionTarget)}
        onOpenChange={(o) => {
          if (!o) setDecisionTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {decisionTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                  {decisionTarget.mode === "approve" ? (
                    <>
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      Approve {decisionTarget.request.request_number}
                    </>
                  ) : (
                    <>
                      <XCircle className="size-4 text-rose-600" />
                      Reject {decisionTarget.request.request_number}
                    </>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  {decisionTarget.request.item_name} ·{" "}
                  <strong className="font-mono text-slate-800">
                    {formatMoney(decisionTarget.request.total_amount, currency)}
                  </strong>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-2">
                {modalError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    {modalError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="modal-decision-comment" className="text-xs font-medium">
                    {decisionTarget.mode === "reject" ? (
                      <>
                        Rejection Reason <span className="text-rose-500">*</span> (min 5 characters)
                      </>
                    ) : (
                      "Approval Note (optional)"
                    )}
                  </Label>
                  <Textarea
                    id="modal-decision-comment"
                    rows={3}
                    placeholder={
                      decisionTarget.mode === "reject"
                        ? "Explain why this purchase request cannot be approved..."
                        : "Optional note for procurement / requester..."
                    }
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDecisionTarget(null)}
                  disabled={isMutating}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={decisionTarget.mode === "reject" ? "destructive" : "default"}
                  disabled={isMutating}
                  onClick={handleConfirmDecision}
                  className={
                    decisionTarget.mode === "approve"
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                      : "gap-1.5"
                  }
                >
                  {isMutating && <Loader2 className="size-3.5 animate-spin" />}
                  {decisionTarget.mode === "approve"
                    ? "Confirm Approval & Lock"
                    : "Confirm Rejection"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <RequestDetailSheet
        request={selectedRequest}
        open={Boolean(selectedRequest)}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null);
        }}
        profile={context.profile}
        currency={currency}
        allowSelfApproval={context.settings.allow_self_approval}
      />
    </div>
  );
}
