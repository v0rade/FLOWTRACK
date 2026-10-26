import { describe, expect, it } from "vitest";
import {
  buildDepartmentSeries,
  buildMonthlySeries,
  buildStatusDistribution,
  calculateKpis,
  calculateProcessComparison,
  filterAnalyticsRecords,
} from "@/lib/analytics";
import type { AnalyticsRecord, Department } from "@/lib/types";

const departments: Department[] = [
  { id: "d-ops", code: "OPS", name: "Operations", is_active: true },
  { id: "d-it", code: "IT", name: "Information Technology", is_active: true },
  { id: "d-fin", code: "FIN", name: "Finance", is_active: true },
];

const sampleRecords: AnalyticsRecord[] = [
  {
    status: "approved",
    department_id: "d-ops",
    total_amount: "12000000.50",
    created_at: "2026-09-05T08:00:00Z",
    submitted_at: "2026-09-05T09:00:00Z",
    decided_at: "2026-09-05T15:00:00Z", // 6 hours
  },
  {
    status: "approved",
    department_id: "d-it",
    total_amount: "28000000.25",
    created_at: "2026-10-02T08:00:00Z",
    submitted_at: "2026-10-02T10:00:00Z",
    decided_at: "2026-10-03T04:00:00Z", // 18 hours
  },
  {
    status: "rejected",
    department_id: "d-ops",
    total_amount: "5000000.00",
    created_at: "2026-10-10T08:00:00Z",
    submitted_at: "2026-10-10T09:00:00Z",
    decided_at: "2026-10-10T21:00:00Z", // 12 hours
  },
  {
    status: "pending_approval",
    department_id: "d-it",
    total_amount: "7500000.00",
    created_at: "2026-10-18T10:00:00Z",
    submitted_at: "2026-10-18T10:30:00Z",
    decided_at: null,
  },
  {
    status: "draft",
    department_id: "d-fin",
    total_amount: "2500000.25",
    created_at: "2026-10-20T11:00:00Z",
    submitted_at: null,
    decided_at: null,
  },
  {
    status: "cancelled",
    department_id: "d-ops",
    total_amount: "99000000.00",
    created_at: "2026-10-21T11:00:00Z",
    submitted_at: null,
    decided_at: null,
  },
];

describe("dashboard KPI and chart calculations", () => {
  it("computes exact KPI totals, completion rate, and average approval hours", () => {
    const kpis = calculateKpis(sampleRecords);
    expect(kpis.totalRequests).toBe(6);
    expect(kpis.approvedRequests).toBe(2);
    expect(kpis.rejectedRequests).toBe(1);
    expect(kpis.pendingApprovals).toBe(1);
    expect(kpis.draftRequests).toBe(1);
    expect(kpis.cancelledRequests).toBe(1);

    // Requested spending excludes cancelled: 12,000,000.50 + 28,000,000.25 + 5,000,000 + 7,500,000 + 2,500,000.25 = 55,000,001.00
    expect(kpis.totalRequestedSpending).toBe("55000001.00");
    // Approved spending: 12,000,000.50 + 28,000,000.25 = 40,000,000.75
    expect(kpis.totalApprovedSpending).toBe("40000000.75");
    expect(kpis.totalPendingSpending).toBe("7500000.00");

    // Approval hours: (6 + 18 + 12) / 3 = 12.0 hours
    expect(kpis.averageApprovalHours).toBe(12);
    // Completion rate: 3 decided / 4 submitted (pending + approved + rejected) = 75%
    expect(kpis.approvalCompletionRate).toBe(75);
    // Win rate: 2 approved / 3 decided = 66.7%
    expect(kpis.approvalWinRate).toBe(66.7);
  });

  it("filters records by date range and department", () => {
    const octOps = filterAnalyticsRecords(sampleRecords, {
      from: "2026-10-01",
      to: "2026-10-31",
      departmentId: "d-ops",
    });
    expect(octOps).toHaveLength(2); // 1 rejected + 1 cancelled in Oct for OPS
    const kpis = calculateKpis(octOps);
    expect(kpis.totalRequestedSpending).toBe("5000000.00");
  });

  it("builds monthly, department, and status chart series", () => {
    const monthly = buildMonthlySeries(sampleRecords);
    expect(monthly.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    expect(monthly[0].approvedDecimal).toBe("12000000.50");
    expect(monthly[1].requestedDecimal).toBe("43000000.50");

    const byDept = buildDepartmentSeries(sampleRecords, departments);
    expect(byDept[0].code).toBe("IT");
    expect(byDept[0].requestedDecimal).toBe("35500000.25");

    const byStatus = buildStatusDistribution(sampleRecords);
    const approvedEntry = byStatus.find((s) => s.status === "approved")!;
    expect(approvedEntry.count).toBe(2);
    expect(approvedEntry.amountDecimal).toBe("40000000.75");
  });

  it("computes before-and-after process comparison with separated estimated vs measured metrics", () => {
    const comparison = calculateProcessComparison(sampleRecords, {
      manual_minutes_per_request: 95,
      digital_minutes_per_request: 20,
      manual_cycle_days: "5.00",
      hourly_staff_cost: "85000.00",
    });

    // 5 non-cancelled requests × (95 - 20 = 75 min) = 375 min = 6.3 hours
    expect(comparison.requestCount).toBe(5);
    expect(comparison.estimated.minutesSavedPerRequest).toBe(75);
    expect(comparison.estimated.totalHoursSaved).toBe(6.3);
    expect(comparison.estimated.effortReductionPercent).toBe(78.9);
    // 375 / 60 * 85,000 = 531,250.00
    expect(comparison.estimated.estimatedCostSavedDecimal).toBe("531250.00");

    // Measured: 12h avg vs 120h (5 days) baseline = 90% faster turnaround
    expect(comparison.measured.decidedSampleSize).toBe(3);
    expect(comparison.measured.averageApprovalHours).toBe(12);
    expect(comparison.measured.cycleTimeReductionPercent).toBe(90);
  });
});
