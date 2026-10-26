"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  Clock,
  FileEdit,
  History,
  Loader2,
  Lock,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RoleBadge, StatusBadge } from "./status-badge";
import { formatMoney } from "@/lib/money";
import {
  canCancel,
  canEditDraft,
  canSubmit,
  checkDecisionPermission,
  isTerminal,
  STATUS_LABELS,
} from "@/lib/workflow";
import {
  approvePurchaseRequestAction,
  cancelPurchaseRequestAction,
  fetchRequestDetailAction,
  rejectPurchaseRequestAction,
  submitPurchaseRequestAction,
} from "@/app/actions";
import type {
  EnrichedApprovalAction,
  EnrichedAuditLog,
  EnrichedPurchaseRequest,
} from "@/lib/data";
import type { Profile } from "@/lib/types";

export function RequestDetailSheet({
  request,
  open,
  onOpenChange,
  profile,
  currency,
  allowSelfApproval,
  onEditDraft,
}: {
  request: EnrichedPurchaseRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile;
  currency: string;
  allowSelfApproval: boolean;
  onEditDraft?: (req: EnrichedPurchaseRequest) => void;
}) {
  const router = useRouter();
  const [actions, setActions] = React.useState<EnrichedApprovalAction[]>([]);
  const [audits, setAudits] = React.useState<EnrichedAuditLog[]>([]);
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"timeline" | "audit">("timeline");

  const [decisionNote, setDecisionNote] = React.useState("");
  const [decisionError, setDecisionError] = React.useState<string | null>(null);
  const [isMutating, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open || !request) return;
    let active = true;
    Promise.resolve().then(async () => {
      if (!active) return;
      setDecisionNote("");
      setDecisionError(null);
      setLoadingHistory(true);
      const res = await fetchRequestDetailAction(request.id);
      if (!active) return;
      if (res.ok) {
        setActions(res.data.actions);
        setAudits(res.data.audits);
      }
      setLoadingHistory(false);
    });
    return () => {
      active = false;
    };
  }, [open, request?.id, request?.version, request?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!request) return null;

  const decisionPerm = checkDecisionPermission(profile, request, {
    allowSelfApproval,
  });
  const mayEdit = canEditDraft(profile, request);
  const maySubmit = canSubmit(profile, request);
  const mayCancel = canCancel(profile, request);
  const locked = isTerminal(request.status);

  function handleSubmitDraft() {
    if (!request) return;
    startTransition(async () => {
      const res = await submitPurchaseRequestAction(request.id);
      if (res.ok) {
        toast.success(res.message ?? "Submitted for approval");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleApprove() {
    if (!request) return;
    setDecisionError(null);
    startTransition(async () => {
      const res = await approvePurchaseRequestAction({
        id: request.id,
        comment: decisionNote.trim() || undefined,
      });
      if (res.ok) {
        toast.success(res.message ?? "Request approved");
        setDecisionNote("");
        router.refresh();
      } else {
        setDecisionError(res.error);
        toast.error(res.error);
      }
    });
  }

  function handleReject() {
    if (!request) return;
    if (decisionNote.trim().length < 5) {
      setDecisionError("A rejection reason of at least 5 characters is required.");
      return;
    }
    setDecisionError(null);
    startTransition(async () => {
      const res = await rejectPurchaseRequestAction({
        id: request.id,
        reason: decisionNote.trim(),
      });
      if (res.ok) {
        toast.success(res.message ?? "Request rejected");
        setDecisionNote("");
        router.refresh();
      } else {
        setDecisionError(res.error);
        toast.error(res.error);
      }
    });
  }

  function handleCancel() {
    if (!request) return;
    startTransition(async () => {
      const res = await cancelPurchaseRequestAction({
        id: request.id,
        reason: decisionNote.trim() || "Cancelled by authorized user",
      });
      if (res.ok) {
        toast.success(res.message ?? "Request cancelled");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-0">
        <div className="p-6 space-y-6">
          <SheetHeader className="space-y-2 border-b border-slate-100 pb-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded px-2 py-0.5">
                {request.request_number}
              </span>
              <StatusBadge status={request.status} />
            </div>
            <SheetTitle className="text-lg font-bold text-slate-900 leading-snug">
              {request.item_name}
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              Requested by <strong className="text-slate-700">{request.requester_name}</strong> ({request.requester_email}) ·{" "}
              <span className="font-medium text-slate-700">
                {request.department_code} — {request.department_name}
              </span>
            </SheetDescription>
          </SheetHeader>

          {/* Immutability / Lock banner for terminal requests */}
          {locked && (
            <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
              <Lock className="size-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-800">
                  Record Locked ({STATUS_LABELS[request.status]})
                </p>
                <p className="text-[11px] text-slate-500">
                  PostgreSQL triggers prevent any modification or deletion of {request.status.replace("_", " ")} requests.
                </p>
              </div>
            </div>
          )}

          {/* Financial & metadata summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
            <div>
              <p className="text-[11px] font-medium text-slate-500">Quantity</p>
              <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {request.quantity.toLocaleString("en-US")} units
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Estimated Unit Price</p>
              <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {formatMoney(request.unit_price, currency)}
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-[11px] font-medium text-teal-700">Server Calculated Total</p>
              <p className="font-mono text-base font-bold text-teal-900 tabular-nums">
                {formatMoney(request.total_amount, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Created Date</p>
              <p className="font-mono text-xs text-slate-800">{request.created_at.slice(0, 10)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Required Date</p>
              <p className="font-mono text-xs text-slate-800">{request.required_date}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Source · Version</p>
              <p className="font-mono text-xs text-slate-800">
                {request.source} · v{request.version}
              </p>
            </div>
          </div>

          {/* Item description & Business justification */}
          <div className="space-y-3 text-xs">
            {request.description && (
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="font-semibold text-slate-700 mb-1">Item Description & Specs</p>
                <p className="text-slate-600 leading-relaxed">{request.description}</p>
              </div>
            )}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="font-semibold text-slate-700 mb-1">Business Justification</p>
              <p className="text-slate-600 leading-relaxed">{request.justification}</p>
            </div>

            {request.decision_comment && (
              <div
                className={
                  request.status === "rejected"
                    ? "rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-rose-900"
                    : "rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-emerald-900"
                }
              >
                <p className="font-semibold mb-0.5">
                  {request.status === "rejected" ? "Rejection Reason" : "Approval Note"}{" "}
                  {request.decided_by_name ? `by ${request.decided_by_name}` : ""}
                </p>
                <p className="leading-relaxed">{request.decision_comment}</p>
              </div>
            )}
          </div>

          {/* Contextual Workflow Controls */}
          {(mayEdit || maySubmit || mayCancel || request.status === "pending_approval") && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900">Workflow Actions</p>
                <span className="text-[11px] text-slate-400">Transactional DB RPC</span>
              </div>

              {/* Draft owner actions */}
              {(mayEdit || maySubmit) && (
                <div className="flex flex-wrap items-center gap-2">
                  {mayEdit && onEditDraft && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onOpenChange(false);
                        onEditDraft(request);
                      }}
                      disabled={isMutating}
                      className="gap-1.5"
                    >
                      <FileEdit className="size-3.5" />
                      Edit Draft
                    </Button>
                  )}
                  {maySubmit && (
                    <Button
                      size="sm"
                      onClick={handleSubmitDraft}
                      disabled={isMutating}
                      className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
                    >
                      {isMutating ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Submit for Approval
                    </Button>
                  )}
                </div>
              )}

              {/* Manager / Admin approval box */}
              {request.status === "pending_approval" && (
                <>
                  {decisionPerm.allowed ? (
                    <div className="space-y-2.5 pt-1">
                      <div className="space-y-1">
                        <Label htmlFor="decision-note" className="text-xs text-slate-700">
                          Decision Comment / Rejection Reason (required when rejecting)
                        </Label>
                        <Textarea
                          id="decision-note"
                          rows={2}
                          placeholder="Add approval note or explain why this request is rejected (min 5 chars for rejection)..."
                          value={decisionNote}
                          onChange={(e) => setDecisionNote(e.target.value)}
                        />
                        {decisionError && (
                          <p className="text-xs text-rose-600">{decisionError}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          onClick={handleApprove}
                          disabled={isMutating}
                          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          {isMutating ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="size-3.5" />
                          )}
                          Approve Request
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleReject}
                          disabled={isMutating}
                          className="gap-1.5"
                        >
                          <XCircle className="size-3.5" />
                          Reject Request
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      {decisionPerm.reason}
                    </p>
                  )}
                </>
              )}

              {mayCancel && (
                <div className="pt-1 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    Need to withdraw this request?
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleCancel}
                    disabled={isMutating}
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 gap-1"
                  >
                    <Ban className="size-3" />
                    Cancel Request
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Approval History & Audit Trail Tabs */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-200">
              <button
                type="button"
                onClick={() => setActiveTab("timeline")}
                className={`flex items-center gap-1.5 border-b-2 pb-2 px-1 text-xs font-semibold transition-colors ${
                  activeTab === "timeline"
                    ? "border-teal-600 text-teal-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <Clock className="size-3.5" />
                Approval Timeline ({actions.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("audit")}
                className={`flex items-center gap-1.5 border-b-2 pb-2 px-1 text-xs font-semibold transition-colors ${
                  activeTab === "audit"
                    ? "border-teal-600 text-teal-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <History className="size-3.5" />
                Database Audit Log ({audits.length})
              </button>
            </div>

            {loadingHistory ? (
              <div className="flex items-center justify-center py-8 text-xs text-slate-400 gap-2">
                <Loader2 className="size-4 animate-spin" />
                Loading immutable history from PostgreSQL...
              </div>
            ) : activeTab === "timeline" ? (
              <ol className="relative border-l border-slate-200 ml-3 space-y-4 py-1">
                {actions.map((act) => (
                  <li key={act.id} className="ml-4 space-y-1">
                    <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-white bg-teal-600" />
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-900 capitalize">
                        {act.action.replace("_", " ")}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {new Date(act.created_at).toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                      <span>Actor: <strong className="text-slate-800">{act.actor_name ?? "System"}</strong></span>
                      {act.actor_role && <RoleBadge role={act.actor_role} />}
                      <span className="text-[11px] text-slate-400">
                        {act.from_status ? `${STATUS_LABELS[act.from_status]} → ` : ""}
                        {STATUS_LABELS[act.to_status]}
                      </span>
                    </div>
                    {act.comment && (
                      <p className="rounded-md bg-slate-50 border border-slate-200/80 px-2.5 py-1.5 text-xs text-slate-700">
                        “{act.comment}”
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="space-y-2">
                {audits.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 font-mono font-semibold text-slate-800">
                        <ShieldCheck className="size-3.5 text-teal-600" />
                        {log.operation} · #{log.id}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {new Date(log.created_at).toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    <p className="text-slate-600">
                      Actor: <strong className="text-slate-800">{log.actor_name}</strong>
                    </p>
                    {log.changed_fields.length > 0 && (
                      <p className="text-[11px] text-slate-500">
                        Changed columns:{" "}
                        <span className="font-mono text-slate-700">
                          {log.changed_fields.join(", ")}
                        </span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
