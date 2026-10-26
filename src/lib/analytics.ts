import { centsToDecimalString, parseMoneyToCents, sumCents } from "./money";
import { STATUS_LABELS } from "./workflow";
import type { AnalyticsRecord, AppSettings, Department, RequestStatus } from "./types";

export interface AnalyticsFilter {
  /** Inclusive YYYY-MM-DD lower bound on created_at (UTC date). */
  from?: string;
  /** Inclusive YYYY-MM-DD upper bound on created_at (UTC date). */
  to?: string;
  /** Department UUID or "all". */
  departmentId?: string;
}

export interface KpiMetrics {
  totalRequests: number;
  draftRequests: number;
  pendingApprovals: number;
  approvedRequests: number;
  rejectedRequests: number;
  cancelledRequests: number;
  /** Decimal string in currency units, e.g. "48250000.00" (excludes cancelled). */
  totalRequestedSpending: string;
  /** Decimal string in currency units for approved requests only. */
  totalApprovedSpending: string;
  /** Decimal string in currency units for pending_approval requests. */
  totalPendingSpending: string;
  totalRequestedCents: bigint;
  totalApprovedCents: bigint;
  totalPendingCents: bigint;
  /** Average hours between submitted_at and decided_at for decided requests, or null if none. */
  averageApprovalHours: number | null;
  /**
   * Percentage (0..100) of submitted, non-cancelled requests that have reached a decision
   * (approved + rejected) / (pending_approval + approved + rejected), or null if none submitted.
   */
  approvalCompletionRate: number | null;
  /**
   * Percentage (0..100) of decided requests that were approved:
   * approved / (approved + rejected), or null if none decided.
   */
  approvalWinRate: number | null;
}

export interface MonthlySeriesPoint {
  /** YYYY-MM key */
  month: string;
  /** Short human label e.g. "Oct 2026" */
  label: string;
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  draft: number;
  /** Numeric currency units (for Recharts plotting) */
  requestedAmount: number;
  approvedAmount: number;
  /** Exact decimal strings for tooltips/tables */
  requestedDecimal: string;
  approvedDecimal: string;
}

export interface DepartmentSeriesPoint {
  departmentId: string;
  code: string;
  name: string;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  requestedAmount: number;
  approvedAmount: number;
  requestedDecimal: string;
  approvedDecimal: string;
}

export interface StatusDistributionPoint {
  status: RequestStatus;
  label: string;
  count: number;
  amount: number;
  amountDecimal: string;
}

export interface ProcessComparisonEstimate {
  /** Number of non-cancelled requests included in the estimate */
  requestCount: number;
  /** Configured illustrative assumptions (NOT measured results) */
  assumptions: {
    manualMinutesPerRequest: number;
    digitalMinutesPerRequest: number;
    manualCycleDays: number;
    hourlyStaffCost: string;
  };
  /** Estimated metrics derived from the illustrative assumptions */
  estimated: {
    minutesSavedPerRequest: number;
    totalHoursSaved: number;
    estimatedCostSavedDecimal: string;
    effortReductionPercent: number;
  };
  /** Measured turnaround from actual timestamps in the database */
  measured: {
    decidedSampleSize: number;
    averageApprovalHours: number | null;
    averageApprovalDays: number | null;
    cycleTimeReductionPercent: number | null;
  };
}

/** Filter records by date range (UTC YYYY-MM-DD of created_at) and department. */
export function filterAnalyticsRecords<T extends AnalyticsRecord>(
  records: readonly T[],
  filter: AnalyticsFilter = {},
): T[] {
  const from = filter.from?.trim() || undefined;
  const to = filter.to?.trim() || undefined;
  const dept = filter.departmentId && filter.departmentId !== "all" ? filter.departmentId : undefined;

  return records.filter((r) => {
    if (dept && r.department_id !== dept) return false;
    const createdDate = r.created_at.slice(0, 10);
    if (from && createdDate < from) return false;
    if (to && createdDate > to) return false;
    return true;
  });
}

/** Calculate KPI summary from stored records using exact BigInt cents arithmetic. */
export function calculateKpis(records: readonly AnalyticsRecord[]): KpiMetrics {
  let draftRequests = 0;
  let pendingApprovals = 0;
  let approvedRequests = 0;
  let rejectedRequests = 0;
  let cancelledRequests = 0;

  const requestedCentsList: bigint[] = [];
  const approvedCentsList: bigint[] = [];
  const pendingCentsList: bigint[] = [];

  let approvalDurationHoursSum = 0;
  let approvalDurationCount = 0;

  for (const r of records) {
    const cents = parseMoneyToCents(r.total_amount);

    switch (r.status) {
      case "draft":
        draftRequests++;
        requestedCentsList.push(cents);
        break;
      case "pending_approval":
        pendingApprovals++;
        requestedCentsList.push(cents);
        pendingCentsList.push(cents);
        break;
      case "approved":
        approvedRequests++;
        requestedCentsList.push(cents);
        approvedCentsList.push(cents);
        break;
      case "rejected":
        rejectedRequests++;
        requestedCentsList.push(cents);
        break;
      case "cancelled":
        cancelledRequests++;
        break;
    }

    if ((r.status === "approved" || r.status === "rejected") && r.submitted_at && r.decided_at) {
      const submittedMs = Date.parse(r.submitted_at);
      const decidedMs = Date.parse(r.decided_at);
      if (Number.isFinite(submittedMs) && Number.isFinite(decidedMs) && decidedMs >= submittedMs) {
        approvalDurationHoursSum += (decidedMs - submittedMs) / 3_600_000;
        approvalDurationCount++;
      }
    }
  }

  const totalRequestedCents = sumCents(requestedCentsList);
  const totalApprovedCents = sumCents(approvedCentsList);
  const totalPendingCents = sumCents(pendingCentsList);

  const decidedCount = approvedRequests + rejectedRequests;
  const submittedActiveCount = pendingApprovals + decidedCount;

  const averageApprovalHours =
    approvalDurationCount > 0 ? Math.round((approvalDurationHoursSum / approvalDurationCount) * 10) / 10 : null;

  const approvalCompletionRate =
    submittedActiveCount > 0 ? Math.round((decidedCount / submittedActiveCount) * 1000) / 10 : null;

  const approvalWinRate = decidedCount > 0 ? Math.round((approvedRequests / decidedCount) * 1000) / 10 : null;

  return {
    totalRequests: records.length,
    draftRequests,
    pendingApprovals,
    approvedRequests,
    rejectedRequests,
    cancelledRequests,
    totalRequestedSpending: centsToDecimalString(totalRequestedCents),
    totalApprovedSpending: centsToDecimalString(totalApprovedCents),
    totalPendingSpending: centsToDecimalString(totalPendingCents),
    totalRequestedCents,
    totalApprovedCents,
    totalPendingCents,
    averageApprovalHours,
    approvalCompletionRate,
    approvalWinRate,
  };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${y}`;
}

export function buildMonthlySeries(records: readonly AnalyticsRecord[]): MonthlySeriesPoint[] {
  const buckets = new Map<
    string,
    {
      total: number;
      approved: number;
      rejected: number;
      pending: number;
      draft: number;
      requestedCents: bigint;
      approvedCents: bigint;
    }
  >();

  for (const r of records) {
    const ym = r.created_at.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    let b = buckets.get(ym);
    if (!b) {
      b = {
        total: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        draft: 0,
        requestedCents: 0n,
        approvedCents: 0n,
      };
      buckets.set(ym, b);
    }
    const cents = parseMoneyToCents(r.total_amount);
    b.total++;
    if (r.status !== "cancelled") {
      b.requestedCents += cents;
    }
    if (r.status === "approved") {
      b.approved++;
      b.approvedCents += cents;
    } else if (r.status === "rejected") {
      b.rejected++;
    } else if (r.status === "pending_approval") {
      b.pending++;
    } else if (r.status === "draft") {
      b.draft++;
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => {
      const requestedDecimal = centsToDecimalString(b.requestedCents);
      const approvedDecimal = centsToDecimalString(b.approvedCents);
      return {
        month,
        label: formatMonthLabel(month),
        total: b.total,
        approved: b.approved,
        rejected: b.rejected,
        pending: b.pending,
        draft: b.draft,
        requestedAmount: Number(requestedDecimal),
        approvedAmount: Number(approvedDecimal),
        requestedDecimal,
        approvedDecimal,
      };
    });
}

export function buildDepartmentSeries(
  records: readonly AnalyticsRecord[],
  departments: readonly Pick<Department, "id" | "code" | "name">[],
): DepartmentSeriesPoint[] {
  const map = new Map<
    string,
    {
      code: string;
      name: string;
      total: number;
      approved: number;
      pending: number;
      rejected: number;
      requestedCents: bigint;
      approvedCents: bigint;
    }
  >();

  for (const d of departments) {
    map.set(d.id, {
      code: d.code,
      name: d.name,
      total: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
      requestedCents: 0n,
      approvedCents: 0n,
    });
  }

  for (const r of records) {
    let entry = map.get(r.department_id);
    if (!entry) {
      entry = {
        code: "OTHER",
        name: "Other",
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        requestedCents: 0n,
        approvedCents: 0n,
      };
      map.set(r.department_id, entry);
    }
    const cents = parseMoneyToCents(r.total_amount);
    entry.total++;
    if (r.status !== "cancelled") {
      entry.requestedCents += cents;
    }
    if (r.status === "approved") {
      entry.approved++;
      entry.approvedCents += cents;
    } else if (r.status === "pending_approval") {
      entry.pending++;
    } else if (r.status === "rejected") {
      entry.rejected++;
    }
  }

  return [...map.entries()]
    .map(([departmentId, v]) => {
      const requestedDecimal = centsToDecimalString(v.requestedCents);
      const approvedDecimal = centsToDecimalString(v.approvedCents);
      return {
        departmentId,
        code: v.code,
        name: v.name,
        total: v.total,
        approved: v.approved,
        pending: v.pending,
        rejected: v.rejected,
        requestedAmount: Number(requestedDecimal),
        approvedAmount: Number(approvedDecimal),
        requestedDecimal,
        approvedDecimal,
      };
    })
    .filter((d) => d.total > 0 || departments.length <= 8)
    .sort((a, b) => b.requestedAmount - a.requestedAmount || b.total - a.total);
}

const ORDERED_STATUSES: RequestStatus[] = ["approved", "pending_approval", "draft", "rejected", "cancelled"];

export function buildStatusDistribution(records: readonly AnalyticsRecord[]): StatusDistributionPoint[] {
  const counts = new Map<RequestStatus, { count: number; cents: bigint }>();
  for (const s of ORDERED_STATUSES) counts.set(s, { count: 0, cents: 0n });

  for (const r of records) {
    const item = counts.get(r.status);
    if (!item) continue;
    item.count++;
    item.cents += parseMoneyToCents(r.total_amount);
  }

  return ORDERED_STATUSES.map((status) => {
    const { count, cents } = counts.get(status)!;
    const amountDecimal = centsToDecimalString(cents);
    return {
      status,
      label: STATUS_LABELS[status],
      count,
      amount: Number(amountDecimal),
      amountDecimal,
    };
  });
}

/**
 * Computes the Before-and-After Process Comparison panel values.
 * Keeps illustrative assumptions strictly separated from measured results.
 */
export function calculateProcessComparison(
  records: readonly AnalyticsRecord[],
  settings: Pick<
    AppSettings,
    "manual_minutes_per_request" | "digital_minutes_per_request" | "manual_cycle_days" | "hourly_staff_cost"
  >,
): ProcessComparisonEstimate {
  const kpis = calculateKpis(records);
  const activeCount = records.filter((r) => r.status !== "cancelled").length;
  const decidedSampleSize = kpis.approvedRequests + kpis.rejectedRequests;

  const manualMin = Math.max(1, settings.manual_minutes_per_request);
  const digitalMin = Math.max(1, settings.digital_minutes_per_request);
  const minutesSavedPerRequest = Math.max(0, manualMin - digitalMin);
  const totalMinutesSaved = activeCount * minutesSavedPerRequest;
  const totalHoursSaved = Math.round((totalMinutesSaved / 60) * 10) / 10;

  // Cost saved = (totalMinutesSaved / 60) * hourlyStaffCost, computed in cents
  const hourlyCostCents = parseMoneyToCents(settings.hourly_staff_cost);
  const savedCostCents = (BigInt(totalMinutesSaved) * hourlyCostCents) / 60n;

  const effortReductionPercent =
    manualMin > 0 ? Math.max(0, Math.round(((manualMin - digitalMin) / manualMin) * 1000) / 10) : 0;

  const manualCycleDays = Number(settings.manual_cycle_days) || 5;
  const manualCycleHours = manualCycleDays * 24;
  const averageApprovalDays =
    kpis.averageApprovalHours !== null ? Math.round((kpis.averageApprovalHours / 24) * 100) / 100 : null;

  const cycleTimeReductionPercent =
    kpis.averageApprovalHours !== null && manualCycleHours > 0
      ? Math.round(((manualCycleHours - kpis.averageApprovalHours) / manualCycleHours) * 1000) / 10
      : null;

  return {
    requestCount: activeCount,
    assumptions: {
      manualMinutesPerRequest: manualMin,
      digitalMinutesPerRequest: digitalMin,
      manualCycleDays,
      hourlyStaffCost: settings.hourly_staff_cost,
    },
    estimated: {
      minutesSavedPerRequest,
      totalHoursSaved,
      estimatedCostSavedDecimal: centsToDecimalString(savedCostCents),
      effortReductionPercent,
    },
    measured: {
      decidedSampleSize,
      averageApprovalHours: kpis.averageApprovalHours,
      averageApprovalDays,
      cycleTimeReductionPercent,
    },
  };
}
