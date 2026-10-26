"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/money";
import type {
  DepartmentSeriesPoint,
  MonthlySeriesPoint,
  StatusDistributionPoint,
} from "@/lib/analytics";
import type { RequestStatus } from "@/lib/types";

const STATUS_COLORS: Record<RequestStatus, string> = {
  approved: "#0d9488", // teal-600
  pending_approval: "#f59e0b", // amber-500
  draft: "#64748b", // slate-500
  rejected: "#e11d48", // rose-600
  cancelled: "#cbd5e1", // slate-300
};

export function DashboardCharts({
  monthly,
  byDepartment,
  byStatus,
  currency,
}: {
  monthly: MonthlySeriesPoint[];
  byDepartment: DepartmentSeriesPoint[];
  byStatus: StatusDistributionPoint[];
  currency: string;
}) {
  const nonZeroStatus = byStatus.filter((s) => s.count > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* 1. Requests by Month */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Requests by Month
            </h3>
            <p className="text-xs text-slate-500">
              Monthly purchase request volume segmented by workflow status
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-600">
            Volume
          </span>
        </div>

        {monthly.length === 0 ? (
          <EmptyChart message="No requests match the selected date or department filter." />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#475569" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#475569" }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "10px",
                    borderColor: "#e2e8f0",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="approved" name="Approved" stackId="a" fill="#0d9488" radius={[0, 0, 0, 0]} />
                <Bar dataKey="pending" name="Pending" stackId="a" fill="#f59e0b" />
                <Bar dataKey="draft" name="Draft" stackId="a" fill="#64748b" />
                <Bar dataKey="rejected" name="Rejected" stackId="a" fill="#e11d48" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 2. Requested vs Approved Spending */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Requested vs. Approved Spending
            </h3>
            <p className="text-xs text-slate-500">
              Monthly budget requested compared against manager-approved spend ({currency})
            </p>
          </div>
          <span className="rounded bg-teal-50 border border-teal-200 px-2 py-0.5 font-mono text-[10px] font-medium text-teal-800">
            {currency}
          </span>
        </div>

        {monthly.length === 0 ? (
          <EmptyChart message="No spending records match the selected filters." />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#475569" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#475569" }}
                  tickFormatter={(v) => formatMoney(String(v), currency, true)}
                />
                <Tooltip
                  formatter={(value) => [
                    formatMoney(String(value ?? 0), currency, false),
                    "",
                  ]}
                  contentStyle={{
                    borderRadius: "10px",
                    borderColor: "#e2e8f0",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar
                  dataKey="requestedAmount"
                  name="Requested Spending"
                  fill="#0284c7"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="approvedAmount"
                  name="Approved Spending"
                  fill="#0d9488"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 3. Requests by Department */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Requests by Department
            </h3>
            <p className="text-xs text-slate-500">
              Request distribution across visible organizational units
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-600">
            By Unit
          </span>
        </div>

        {byDepartment.length === 0 ? (
          <EmptyChart message="No department activity for the current filter." />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byDepartment}
                layout="vertical"
                margin={{ top: 4, right: 18, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#475569" }} />
                <YAxis
                  type="category"
                  dataKey="code"
                  width={48}
                  tick={{ fontSize: 11, fill: "#0f172a", fontWeight: 600 }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "10px",
                    borderColor: "#e2e8f0",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="approved" name="Approved" fill="#0d9488" radius={[0, 4, 4, 0]} />
                <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                <Bar dataKey="rejected" name="Rejected" fill="#e11d48" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 4. Approval Status Distribution */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Approval Status Distribution
            </h3>
            <p className="text-xs text-slate-500">
              Share of requests and value across lifecycle stages
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-600">
            Lifecycle
          </span>
        </div>

        {nonZeroStatus.length === 0 ? (
          <EmptyChart message="No status data available." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-3 h-64">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={nonZeroStatus}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={48}
                    outerRadius={76}
                    paddingAngle={3}
                  >
                    {nonZeroStatus.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: "10px",
                      borderColor: "#e2e8f0",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 text-xs">
              {byStatus.map((item) => (
                <div
                  key={item.status}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: STATUS_COLORS[item.status] }}
                    />
                    <span className="font-medium text-slate-700">{item.label}</span>
                  </div>
                  <div className="text-right font-mono">
                    <span className="font-bold text-slate-900">{item.count}</span>
                    <span className="ml-1.5 text-[11px] text-slate-500">
                      ({formatMoney(item.amountDecimal, currency, true)})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 text-center text-xs text-slate-500">
      {message}
    </div>
  );
}
