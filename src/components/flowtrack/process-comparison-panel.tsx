"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Clock,
  Download,
  FlaskConical,
  Gauge,
  Plus,
  Sparkles,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { switchDemoPersonaAction } from "@/app/actions";
import { DEMO_PERSONAS } from "@/lib/supabase/config";
import type { ProcessComparisonEstimate } from "@/lib/analytics";
import type { Profile } from "@/lib/types";

export function ProcessComparisonPanel({
  comparison,
  currency,
  profile,
  isDemoMode,
  onOpenNewRequest,
}: {
  comparison: ProcessComparisonEstimate;
  currency: string;
  profile: Profile;
  isDemoMode: boolean;
  onOpenNewRequest?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  function switchPersona(personaId: string) {
    startTransition(async () => {
      const res = await switchDemoPersonaAction(personaId);
      if (res.ok) {
        toast.success(res.message ?? "Switched demo role");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const rinaId = DEMO_PERSONAS[0].id; // Employee · OPS
  const budiId = DEMO_PERSONAS[1].id; // Manager · OPS

  const steps = [
    {
      num: 1,
      title: "Employee creates a purchase request",
      detail: "Rina Wijaya (OPS Employee) drafts or submits a purchase request with quantity, price, and business justification.",
      action: onOpenNewRequest ? (
        <Button
          size="xs"
           variant="outline"
          onClick={onOpenNewRequest}
          className="gap-1 text-[11px]"
        >
          <Plus className="size-3 text-teal-600" />
          Create Request
        </Button>
      ) : (
        <Link
          href="/requests?new=1"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:underline"
        >
          Open Form <ArrowRight className="size-3" />
        </Link>
      ),
    },
    {
      num: 2,
      title: "Employee submits it for approval",
      detail: "Submitting transitions status from Draft → Pending Approval and timestamps submitted_at.",
      action:
        isDemoMode && profile.role !== "employee" ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={isPending}
            onClick={() => switchPersona(rinaId)}
            className="gap-1 text-[11px] text-teal-700"
          >
            <UserCheck className="size-3" />
            Switch to Rina (Emp)
          </Button>
        ) : (
          <Link
            href="/requests"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:underline"
          >
            View Drafts <ArrowRight className="size-3" />
          </Link>
        ),
    },
    {
      num: 3,
      title: "Authorized Manager approves or rejects",
      detail: "Budi Santoso (OPS Manager) reviews pending OPS requests. Rejections require a documented reason.",
      action:
        isDemoMode && profile.id !== budiId ? (
          <Button
            size="xs"
            variant="outline"
            disabled={isPending}
            onClick={() => switchPersona(budiId)}
            className="gap-1 text-[11px]"
          >
            <UserCheck className="size-3 text-teal-600" />
            Switch to Budi (Mgr)
          </Button>
        ) : (
          <Link
            href="/approvals"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:underline"
          >
            Approval Queue <ArrowRight className="size-3" />
          </Link>
        ),
    },
    {
      num: 4,
      title: "Status & immutable audit history update",
      detail: "PostgreSQL triggers append actor & timestamp to approval_actions and audit_logs; approved rows lock.",
      action: (
        <Link
          href="/requests"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:underline"
        >
          Inspect Audit Trail <ArrowRight className="size-3" />
        </Link>
      ),
    },
    {
      num: 5,
      title: "Dashboard recalculates KPIs live",
      detail: "Approved spending, completion rate, and measured turnaround time update immediately from stored records.",
      action: (
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:underline"
        >
          View Analytics <ArrowRight className="size-3" />
        </Link>
      ),
    },
    {
      num: 6,
      title: "Export authorized CSV report",
      detail: "Download formula-safe CSV reports scoped by Row Level Security for finance or management review.",
      action: (
        <a
          href="/api/requests/export"
          download
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-50"
        >
          <Download className="size-3 text-teal-600" />
          Export CSV
        </a>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      {/* Left 7 cols: Before-and-After Process Comparison Panel */}
      <div className="xl:col-span-7 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col justify-between space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-teal-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Before & After Process Efficiency Comparison
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Contrasting legacy paper/chat approvals with centralized FLOWTRACK workflows across{" "}
              <strong className="text-slate-700">{comparison.requestCount}</strong> active request(s)
            </p>
          </div>
          <Link
            href="/settings"
            className="text-xs font-medium text-teal-700 hover:underline"
          >
            Configure Assumptions →
          </Link>
        </div>

        {/* Before vs After Table */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">
                Before: Manual Paper & Spreadsheet
              </span>
              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700">
                Baseline Assumption
              </span>
            </div>
            <ul className="space-y-1.5 text-slate-600">
              <li className="flex items-center justify-between">
                <span>Handling time / request:</span>
                <strong className="font-mono text-slate-900">
                  {comparison.assumptions.manualMinutesPerRequest} mins
                </strong>
              </li>
              <li className="flex items-center justify-between">
                <span>Typical approval turnaround:</span>
                <strong className="font-mono text-slate-900">
                  {comparison.assumptions.manualCycleDays} days ({comparison.assumptions.manualCycleDays * 24}h)
                </strong>
              </li>
              <li className="flex items-center justify-between">
                <span>Audit & version control:</span>
                <span className="text-rose-700 font-medium">Scattered chats / silent edits</span>
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-teal-950">
                After: FLOWTRACK Digital Workflow
              </span>
              <span className="rounded bg-teal-600/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-900">
                Digitized
              </span>
            </div>
            <ul className="space-y-1.5 text-teal-900/90">
              <li className="flex items-center justify-between">
                <span>Assumed digital handling / request:</span>
                <strong className="font-mono text-teal-950">
                  {comparison.assumptions.digitalMinutesPerRequest} mins
                </strong>
              </li>
              <li className="flex items-center justify-between">
                <span>Measured DB approval turnaround:</span>
                <strong className="font-mono text-teal-950">
                  {comparison.measured.averageApprovalHours !== null
                    ? `${comparison.measured.averageApprovalHours}h (${comparison.measured.averageApprovalDays}d)`
                    : "Awaiting decisions"}
                </strong>
              </li>
              <li className="flex items-center justify-between">
                <span>Audit & version control:</span>
                <span className="text-emerald-800 font-semibold">Immutable DB triggers & RLS</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Separated Measured vs Estimated Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
          {/* Measured box */}
          <div className="rounded-xl border border-sky-200/80 bg-sky-50/50 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-950">
                <Clock className="size-3.5 text-sky-600" />
                Measured Results (Stored DB Timestamps)
              </span>
              <span className="rounded bg-sky-600/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-900">
                n = {comparison.measured.decidedSampleSize}
              </span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <p className="font-mono text-lg font-bold text-sky-950 tabular-nums">
                  {comparison.measured.averageApprovalHours !== null
                    ? `${comparison.measured.averageApprovalHours} hrs`
                    : "—"}
                </p>
                <p className="text-[11px] text-sky-800">
                  Avg time from <code className="font-mono">submitted_at</code> to <code className="font-mono">decided_at</code>
                </p>
              </div>
              {comparison.measured.cycleTimeReductionPercent !== null && (
                <span className="rounded-full bg-sky-600 px-2.5 py-0.5 font-mono text-xs font-semibold text-white">
                  {comparison.measured.cycleTimeReductionPercent}% faster vs baseline
                </span>
              )}
            </div>
          </div>

          {/* Estimated box */}
          <div className="rounded-xl border border-amber-200/90 bg-amber-50/50 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-950">
                <TrendingUp className="size-3.5 text-amber-600" />
                Estimated Savings (Illustrative Model)
              </span>
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-900">
                Estimate Only
              </span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <p className="font-mono text-lg font-bold text-amber-950 tabular-nums">
                  {comparison.estimated.totalHoursSaved} hrs{" "}
                  <span className="text-xs font-normal text-amber-800">
                    ({formatMoney(comparison.estimated.estimatedCostSavedDecimal, currency, true)})
                  </span>
                </p>
                <p className="text-[11px] text-amber-800">
                  {comparison.estimated.minutesSavedPerRequest} min saved/req × {comparison.requestCount} reqs ({comparison.estimated.effortReductionPercent}% less manual effort)
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Explicit disclaimer */}
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1">
          <FlaskConical className="size-3.5 text-slate-400 shrink-0" />
          <span>
            <strong>Methodological Note:</strong> Estimated hours and cost savings are projections calculated from configurable illustrative assumptions ({comparison.assumptions.manualMinutesPerRequest}m manual vs. {comparison.assumptions.digitalMinutesPerRequest}m digital at {formatMoney(comparison.assumptions.hourlyStaffCost, currency)}/hr). They do not represent verified customer outcomes.
          </span>
        </p>
      </div>

      {/* Right 5 cols: Interactive 6-Step Business Impact Demo Scenario */}
      <div className="xl:col-span-5 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col justify-between space-y-3">
        <div className="border-b border-slate-100 pb-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <Sparkles className="size-4 text-teal-600" />
              Interactive 6-Step Business Impact Walkthrough
            </h3>
            <span className="rounded bg-teal-50 border border-teal-200 px-2 py-0.5 font-mono text-[10px] font-semibold text-teal-800">
              Live Demo
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Execute the end-to-end Nusantara Supplies Co. scenario directly in this workspace:
          </p>
        </div>

        <ol className="space-y-2.5 flex-1">
          {steps.map((s) => (
            <li
              key={s.num}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-900 font-mono text-[11px] font-bold text-white mt-0.5">
                  {s.num}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{s.title}</p>
                  <p className="text-[11px] text-slate-500 leading-snug">{s.detail}</p>
                </div>
              </div>
              <div className="shrink-0 self-center">{s.action}</div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
