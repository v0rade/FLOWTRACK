"use client";

import * as React from "react";
import {
  BarChart3,
  Download,
  Filter,
  FlaskConical,
  RotateCcw,
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
import { DashboardCharts } from "./dashboard-charts";
import { ProcessComparisonPanel } from "./process-comparison-panel";
import type { AppSessionContext, EnrichedPurchaseRequest } from "@/lib/data";

export function ReportsClient({
  context,
  requests,
}: {
  context: AppSessionContext;
  requests: EnrichedPurchaseRequest[];
}) {
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("all");

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

  const exportUrl = React.useMemo(() => {
    const params = new URLSearchParams();
    if (departmentId !== "all") params.set("departmentId", departmentId);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const qs = params.toString();
    return `/api/requests/export${qs ? `?${qs}` : ""}`;
  }, [departmentId, fromDate, toDate]);

  const currency = context.settings.currency;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Operational Reports & Spend Analytics
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Departmental budget utilization, approval cycle time analysis, and before-and-after digitization impact.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={exportUrl}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 shadow-2xs"
          >
            <Download className="size-3.5" />
            Export Filtered CSV Report ({filtered.length})
          </a>
        </div>
      </div>

      {/* Explicit Demo Data Notice Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-xs text-teal-950">
        <FlaskConical className="size-4 text-teal-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">
            Demo Dataset Transparency Notice ({context.settings.organization_name})
          </p>
          <p className="text-teal-800">
            All KPIs and charts below are computed dynamically from the stored PostgreSQL records in your authorized scope. Sample records represent fictional demo data and must not be cited as actual customer results.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xs">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <Filter className="size-3.5 text-teal-600" />
          <span>Report Parameters</span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <select
            aria-label="Filter report by department"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800"
          >
            <option value="all">All Visible Departments</option>
            {context.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>

          <Input
            type="date"
            aria-label="Report start date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 w-36 font-mono text-xs"
          />

          <Input
            type="date"
            aria-label="Report end date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 w-36 font-mono text-xs"
          />

          {(fromDate || toDate || departmentId !== "all") && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setDepartmentId("all");
              }}
              className="gap-1"
            >
              <RotateCcw className="size-3" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Executive Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Requested Spend</p>
          <p className="font-mono text-lg font-bold text-slate-900 mt-1 tabular-nums">
            {formatMoney(kpis.totalRequestedSpending, currency)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Across {kpis.totalRequests - kpis.cancelledRequests} active requests
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Approved Spend</p>
          <p className="font-mono text-lg font-bold text-teal-700 mt-1 tabular-nums">
            {formatMoney(kpis.totalApprovedSpending, currency)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {kpis.approvedRequests} approved request(s)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Measured Approval Time</p>
          <p className="font-mono text-lg font-bold text-slate-900 mt-1 tabular-nums">
            {kpis.averageApprovalHours !== null ? `${kpis.averageApprovalHours} hrs` : "—"}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Mean submitted_at → decided_at
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Completion Rate</p>
          <p className="font-mono text-lg font-bold text-slate-900 mt-1 tabular-nums">
            {kpis.approvalCompletionRate !== null ? `${kpis.approvalCompletionRate}%` : "—"}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {kpis.pendingApprovals} currently pending
          </p>
        </div>
      </div>

      {/* Department Breakdown Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-teal-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Departmental Spending & Approval Matrix
              </h3>
              <p className="text-xs text-slate-500">
                Exact decimal aggregation by organizational unit
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Department</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total Reqs</th>
                <th className="px-4 py-2.5 font-semibold text-right">Approved</th>
                <th className="px-4 py-2.5 font-semibold text-right">Pending</th>
                <th className="px-4 py-2.5 font-semibold text-right">Rejected</th>
                <th className="px-4 py-2.5 font-semibold text-right">Requested Spend</th>
                <th className="px-4 py-2.5 font-semibold text-right">Approved Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byDepartment.map((d) => (
                <tr key={d.departmentId} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2.5">
                    <span className="font-mono font-bold text-teal-800 mr-2">{d.code}</span>
                    <span className="font-medium text-slate-800">{d.name}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-right font-semibold">{d.total}</td>
                  <td className="px-4 py-2.5 font-mono text-right text-emerald-700">{d.approved}</td>
                  <td className="px-4 py-2.5 font-mono text-right text-amber-700">{d.pending}</td>
                  <td className="px-4 py-2.5 font-mono text-right text-rose-700">{d.rejected}</td>
                  <td className="px-4 py-2.5 font-mono text-right font-medium text-slate-900 tabular-nums">
                    {formatMoney(d.requestedDecimal, currency)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-right font-bold text-teal-800 tabular-nums">
                    {formatMoney(d.approvedDecimal, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts */}
      <DashboardCharts
        monthly={monthly}
        byDepartment={byDepartment}
        byStatus={byStatus}
        currency={currency}
      />

      {/* Before-and-After Process Comparison */}
      <ProcessComparisonPanel
        comparison={comparison}
        currency={currency}
        profile={context.profile}
        isDemoMode={context.isDemoMode}
      />
    </div>
  );
}
