import { describe, expect, it } from "vitest";
import {
  resetEmbeddedDatabase,
  withAsUser,
} from "@/lib/db/embedded-pg";
import { calculateKpis, calculateProcessComparison } from "@/lib/analytics";
import { toCsv } from "@/lib/csv";
import { DEMO_PERSONAS } from "@/lib/supabase/config";
import type { AnalyticsRecord } from "@/lib/types";

describe("end-to-end 6-step Business Impact Demonstration scenario on seeded DB", () => {
  const rina = DEMO_PERSONAS[0]; // Employee · OPS
  const budi = DEMO_PERSONAS[1]; // Manager · OPS
  const opsDeptId = "00000000-0000-4000-8000-000000000101";

  it("executes steps 1–6: create → submit → manager approve → audit history → KPI recalculate → CSV export", async () => {
    await resetEmbeddedDatabase();

    // Baseline KPIs for OPS manager before the new request
    const beforeRows = await withAsUser(budi.id, async (db) => {
      const res = await db.query<AnalyticsRecord>(`
        select status, department_id, total_amount::text as total_amount,
               created_at::text as created_at, submitted_at::text as submitted_at, decided_at::text as decided_at
        from public.purchase_requests
      `);
      return res.rows;
    });
    const kpiBefore = calculateKpis(beforeRows);

    // Step 1: Employee (Rina) creates a draft purchase request
    const newReqId = await withAsUser(rina.id, async (db) => {
      const res = await db.query<{ id: string }>(
        `select public.create_purchase_request(
          'Automated Barcode Verifier Station',
          'ISO/IEC 15416 inline verifier for outbound pallet labels',
          2,
          '8250000.00'::numeric,
          $1::uuid,
          'Eliminates retailer chargebacks from unreadable GS1-128 pallet labels.',
          (current_date + 14),
          false
        ) as id`,
        [opsDeptId],
      );
      return res.rows[0].id;
    });

    // Step 2: Employee submits the draft for approval
    await withAsUser(rina.id, async (db) => {
      await db.query("select public.submit_purchase_request($1::uuid)", [newReqId]);
    });

    // Step 3: Manager (Budi) approves the pending request
    await withAsUser(budi.id, async (db) => {
      await db.query(
        "select public.approve_purchase_request($1::uuid, 'Approved — directly prevents GS1 chargeback penalties.')",
        [newReqId],
      );
    });

    // Step 4: Verify request status, server-calculated total, approval_actions, and audit_logs
    const verification = await withAsUser(budi.id, async (db) => {
      const req = await db.query<{
        status: string;
        total_amount: string;
        decided_by: string;
      }>(
        "select status, total_amount::text as total_amount, decided_by from public.purchase_requests where id = $1::uuid",
        [newReqId],
      );
      const actions = await db.query<{ action: string; actor_id: string }>(
        "select action, actor_id from public.approval_actions where request_id = $1::uuid order by id asc",
        [newReqId],
      );
      const audits = await db.query<{ operation: string }>(
        "select operation from public.audit_logs where entity_type = 'purchase_request' and entity_id = $1",
        [newReqId],
      );
      return {
        request: req.rows[0],
        actions: actions.rows,
        audits: audits.rows,
      };
    });

    expect(verification.request).toEqual({
      status: "approved",
      total_amount: "16500000.00", // 2 × 8,250,000.00
      decided_by: budi.id,
    });
    expect(verification.actions.map((a) => a.action)).toEqual([
      "created",
      "submitted",
      "approved",
    ]);
    expect(verification.audits).toHaveLength(3);

    // Step 5: Dashboard recalculates its metrics from stored records
    const afterRows = await withAsUser(budi.id, async (db) => {
      const res = await db.query<AnalyticsRecord>(`
        select status, department_id, total_amount::text as total_amount,
               created_at::text as created_at, submitted_at::text as submitted_at, decided_at::text as decided_at
        from public.purchase_requests
      `);
      return res.rows;
    });
    const kpiAfter = calculateKpis(afterRows);
    expect(kpiAfter.totalRequests).toBe(kpiBefore.totalRequests + 1);
    expect(kpiAfter.approvedRequests).toBe(kpiBefore.approvedRequests + 1);
    expect(kpiAfter.totalApprovedCents - kpiBefore.totalApprovedCents).toBe(1_650_000_000n);

    const comparison = calculateProcessComparison(afterRows, {
      manual_minutes_per_request: 95,
      digital_minutes_per_request: 18,
      manual_cycle_days: "5.00",
      hourly_staff_cost: "85000.00",
    });
    expect(comparison.measured.decidedSampleSize).toBeGreaterThanOrEqual(7);

    // Step 6: User exports authorized records to CSV
    const csv = toCsv(
      afterRows.map((r, i) => ({ idx: i + 1, status: r.status, total_amount: r.total_amount })),
      [
        { key: "idx", header: "row" },
        { key: "status", header: "status" },
        { key: "total_amount", header: "total_amount" },
      ],
    );
    expect(csv).toContain("16500000.00");
  });
});
