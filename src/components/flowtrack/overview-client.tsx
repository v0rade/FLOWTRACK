"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  FileSpreadsheet,
  FileUp,
  Filter,
  Percent,
  Plus,
  RotateCcw,
  Timer,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildDepartmentSeries,
  buildMonthlySeries,
  buildStatusDistribution,
  calculateKpis,
  calculateProcessComparison,
  filterAnalyticsRecords,
} from "@/lib/analytics";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "./status-badge";
import { DashboardCharts } from "./dashboard-charts";
import { ProcessComparisonPanel } from "./process-comparison-panel";
import { RequestFormDialog } from "./request-form-dialog";
import { RequestDetailSheet } from "./request-detail-sheet";
import { CsvImportDialog } from "./csv-import-dialog";
import type {
  AppSessionContext,
  EnrichedApprovalAction,
  EnrichedPurchaseRequest,
} from "@/lib/data";

export function OverviewClient({
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
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("all");

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingDraft, setEditingDraft] = React.useState<EnrichedPurchaseRequest | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const selectedRequest = React.useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  const filtered = React.useMemo(
    () =>
      filterAnalyticsRecords(requests, {
        from: fromDate,
        to: toDate,
        departmentId,
      }),
    [requests, fromDate, toDate, departmentId],
  );

  const kpis = React.useMemo(() => calculateKpis(filtered), [filtered]);
  const monthly = React.useMemo(() => buildMonthlySeries(filtered), [filtered]);
  const byDepartment = React.useMemo(
    () => buildDepartmentSeries(filtered, context.departments),
    [filtered, context.departments],
  );
  const byStatus = React.useMemo(() => buildStatusDistribution(filtered), [filtered]);
  const comparison = React.useMemo(
    () => calculateProcessComparison(filtered, context.settings),
    [filtered, context.settings],
  );

  const currency = context.settings.currency;
  const hasFilters = Boolean(fromDate || toDate || departmentId !== "all");

  const exportUrl = React.useMemo(() => {
    const params = new URLSearchParams();
    if (departmentId !== "all") params.set("departmentId", departmentId);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const qs = params.toString();
    return `/api/requests/export${qs ? `?${qs}` : ""}`;
  }, [departmentId, fromDate, toDate]);

  return (
    <div className="space-y-6">
      {/* Page Title & Primary Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Operations Overview & KPI Analytics
            </h1>
            <span className="rounded-md bg-teal-50 border border-teal-200 px-2 py-0.5 font-mono text-xs font-semibold text-teal-800">
              Live DB Metrics
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Centralized purchase request pipeline, approval velocity, and budget utilization for{" "}
            <strong className="text-slate-700">{context.settings.organization_name}</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
            className="gap-1.5"
          >
            <FileUp className="size-3.5 text-teal-600" />
            Import CSV
          </Button>
          <a
            href={exportUrl}
            download
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[0.8rem] font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="size-3.5 text-teal-600" />
            Export CSV
          </a>
          <Button
            size="sm"
            onClick={() => {
              setEditingDraft(null);
              setCreateOpen(true);
            }}
            className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
          >
            <Plus className="size-3.5" />
            New Purchase Request
          </Button>
        </div>
      </div>

      {/* Date & Department Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xs">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <Filter className="size-3.5 text-teal-600" />
          <span>Analytics Scope Filters</span>
          <span className="font-mono text-[11px] font-normal text-slate-400">
            ({filtered.length} of {requests.length} visible record{requests.length === 1 ? "" : "s"})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="flex items-center gap-1.5">
            <label htmlFor="ov-dept" className="text-slate-500 font-medium">
              Department:
            </label>
            <select
              id="ov-dept"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800 outline-none focus:border-teal-600"
            >
              <option value="all">All Visible Departments</option>
              {context.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor="ov-from" className="text-slate-500 font-medium">
              From:
            </label>
            <Input
              id="ov-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 w-36 font-mono text-xs"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor="ov-to" className="text-slate-500 font-medium">
              To:
            </label>
            <Input
              id="ov-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 w-36 font-mono text-xs"
            />
          </div>

          {hasFilters && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setDepartmentId("all");
              }}
              className="gap-1 text-slate-600"
            >
              <RotateCcw className="size-3" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* 8 KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Requests"
          value={kpis.totalRequests.toLocaleString("en-US")}
          subtitle={`${kpis.draftRequests} draft · ${kpis.cancelledRequests} cancelled`}
          icon={FileSpreadsheet}
          tone="slate"
        />
        <KpiCard
          title="Pending Approvals"
          value={kpis.pendingApprovals.toLocaleString("en-US")}
          subtitle={`${formatMoney(kpis.totalPendingSpending, currency, true)} awaiting decision`}
          icon={Clock}
          tone="amber"
        />
        <KpiCard
          title="Approved Requests"
          value={kpis.approvedRequests.toLocaleString("en-US")}
          subtitle={
            kpis.approvalWinRate !== null
              ? `${kpis.approvalWinRate}% approval rate on decided`
              : "No decided requests yet"
          }
          icon={CheckCircle2}
          tone="teal"
        />
        <KpiCard
          title="Rejected Requests"
          value={kpis.rejectedRequests.toLocaleString("en-US")}
          subtitle="Requires documented manager reason"
          icon={XCircle}
          tone="rose"
        />
        <KpiCard
          title="Total Requested Spending"
          value={formatMoney(kpis.totalRequestedSpending, currency, true)}
          subtitle={formatMoney(kpis.totalRequestedSpending, currency, false)}
          icon={DollarSign}
          tone="blue"
        />
        <KpiCard
          title="Total Approved Spending"
          value={formatMoney(kpis.totalApprovedSpending, currency, true)}
          subtitle={formatMoney(kpis.totalApprovedSpending, currency, false)}
          icon={CheckCircle2}
          tone="teal"
        />
        <KpiCard
          title="Average Approval Time"
          value={
            kpis.averageApprovalHours !== null ? `${kpis.averageApprovalHours} hrs` : "—"
          }
          subtitle="Measured from submitted_at → decided_at"
          icon={Timer}
          tone="blue"
        />
        <KpiCard
          title="Approval Completion Rate"
          value={
            kpis.approvalCompletionRate !== null
              ? `${kpis.approvalCompletionRate}%`
              : "—"
          }
          subtitle="Decided vs. total submitted requests"
          icon={Percent}
          tone="teal"
        />
      </div>

      {/* 4 Recharts Analytics Visualizations */}
      <DashboardCharts
        monthly={monthly}
        byDepartment={byDepartment}
        byStatus={byStatus}
        currency={currency}
      />

      {/* Before-and-After Process Comparison + 6-Step Interactive Demo */}
      <ProcessComparisonPanel
        comparison={comparison}
        currency={currency}
        profile={context.profile}
        isDemoMode={context.isDemoMode}
        onOpenNewRequest={() => {
          setEditingDraft(null);
          setCreateOpen(true);
        }}
      />

      {/* Bottom Grid: Recent Purchase Requests Table & Recent Workflow Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Recent Purchase Requests
              </h3>
              <p className="text-xs text-slate-500">
                Click any row to inspect approval history, database audit logs, or take action
              </p>
            </div>
            <Link
              href="/requests"
              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"
            >
              View All ({filtered.length}) <ArrowUpRight className="size-3.5" />
            </Link>
          </div>

          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No purchase requests match the current filter criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Request #</th>
                    <th className="px-4 py-2.5 font-semibold">Item & Requester</th>
                    <th className="px-4 py-2.5 font-semibold">Dept</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.slice(0, 6).map((req) => (
                    <tr
                      key={req.id}
                      onClick={() => setSelectedId(req.id)}
                      className="cursor-pointer hover:bg-slate-50/90 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono font-semibold text-teal-700 whitespace-nowrap">
                        {req.request_number}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900 line-clamp-1">
                          {req.item_name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {req.requester_name} · Needed {req.required_date}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">
                        {req.department_code}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-right text-slate-900 tabular-nums whitespace-nowrap">
                        {formatMoney(req.total_amount, currency)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <StatusBadge status={req.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Approval Activity Stream */}
        <div className="xl:col-span-4 rounded-xl border border-slate-200 bg-white shadow-2xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Immutable Workflow Feed
                </h3>
                <p className="text-xs text-slate-500">
                  Latest recorded approval_actions transitions
                </p>
              </div>
              <Link
                href="/approvals"
                className="text-xs font-semibold text-teal-700 hover:underline"
              >
                Queue →
              </Link>
            </div>

            {recentActivity.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No workflow events recorded yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {recentActivity.slice(0, 6).map((act) => (
                  <li
                    key={act.id}
                    onClick={() => setSelectedId(act.request_id)}
                    className="cursor-pointer rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 text-xs hover:border-teal-200 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-teal-700">
                        {act.request_number}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {new Date(act.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="font-medium text-slate-900 truncate mt-0.5">
                      {act.item_name}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      <strong className="text-slate-700">{act.actor_name}</strong> →{" "}
                      <span className="uppercase font-mono text-[10px] font-semibold text-slate-700">
                        {act.action}
                      </span>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      {/* Modals & Sheets */}
      <RequestFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        profile={context.profile}
        departments={context.departments}
        currency={currency}
        editingDraft={editingDraft}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultDepartmentCode={context.department?.code ?? "OPS"}
      />

      <RequestDetailSheet
        request={selectedRequest}
        open={Boolean(selectedRequest)}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null);
        }}
        profile={context.profile}
        currency={currency}
        allowSelfApproval={context.settings.allow_self_approval}
        onEditDraft={(draft) => {
          setEditingDraft(draft);
          setCreateOpen(true);
        }}
      />
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: typeof Clock;
  tone: "teal" | "blue" | "amber" | "rose" | "slate";
}) {
  const toneClasses = {
    teal: "bg-teal-50 text-teal-700 border-teal-200/80",
    blue: "bg-sky-50 text-sky-700 border-sky-200/80",
    amber: "bg-amber-50 text-amber-700 border-amber-200/80",
    rose: "bg-rose-50 text-rose-700 border-rose-200/80",
    slate: "bg-slate-100 text-slate-700 border-slate-200/80",
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-col justify-between gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600">{title}</span>
        <span className={`flex size-8 items-center justify-center rounded-lg border ${toneClasses}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <div>
        <p className="font-mono text-xl font-bold tracking-tight text-slate-900 tabular-nums">
          {value}
        </p>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}
