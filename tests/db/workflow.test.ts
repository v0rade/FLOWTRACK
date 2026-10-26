import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { actAs, actAsSuperuser, createRequest, createTestDb, DEPT, errorOf, futureDate, USERS } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

async function getRequest(id: string) {
  await actAsSuperuser(db);
  const res = await db.query<{
    status: string;
    total_amount: string;
    version: number;
    decided_by: string | null;
    decision_comment: string | null;
    request_number: string;
  }>(
    "select status, total_amount::text as total_amount, version, decided_by, decision_comment, request_number from public.purchase_requests where id = $1",
    [id],
  );
  return res.rows[0];
}

async function history(id: string) {
  await actAsSuperuser(db);
  const res = await db.query<{ action: string; from_status: string | null; to_status: string; actor_id: string; comment: string | null }>(
    "select action, from_status, to_status, actor_id, comment from public.approval_actions where request_id = $1 order by id",
    [id],
  );
  return res.rows;
}

describe("request creation", () => {
  it("creates a draft with a server-calculated, decimal-exact total and request number", async () => {
    const id = await createRequest(db, USERS.employee, { quantity: 3, unitPrice: "0.10" });
    const row = await getRequest(id);
    expect(row.status).toBe("draft");
    expect(row.total_amount).toBe("0.30"); // 3 × 0.10 — no floating point drift
    expect(row.request_number).toMatch(/^PR-\d{4}-\d{5}$/);
    const h = await history(id);
    expect(h).toEqual([expect.objectContaining({ action: "created", to_status: "draft", actor_id: USERS.employee })]);
  });

  it("computes large totals exactly", async () => {
    const id = await createRequest(db, USERS.employee, { quantity: 7, unitPrice: "14999999.99" });
    expect((await getRequest(id)).total_amount).toBe("104999999.93");
  });

  it("rejects invalid input on the server", async () => {
    await actAs(db, USERS.employee);
    const call = (qty: number, price: string, just: string, date: string) =>
      db.query("select public.create_purchase_request('Desk', '', $1, $2::numeric, $3, $4, $5::date, false)", [
        qty,
        price,
        DEPT.OPS,
        just,
        date,
      ]);
    expect(await errorOf(call(0, "10", "Valid justification text", futureDate()))).toMatch(/^VALIDATION: Quantity/);
    expect(await errorOf(call(1, "-5", "Valid justification text", futureDate()))).toMatch(/^VALIDATION: Unit price/);
    expect(await errorOf(call(1, "10.123", "Valid justification text", futureDate()))).toMatch(/^VALIDATION: Unit price/);
    expect(await errorOf(call(1, "10", "short", futureDate()))).toMatch(/^VALIDATION: Business justification/);
    expect(await errorOf(call(1, "10", "Valid justification text", "2020-01-01"))).toMatch(/^VALIDATION: Required date/);
  });

  it("does not let employees raise requests for another department", async () => {
    await actAs(db, USERS.employee);
    expect(await errorOf(createRequest(db, USERS.employee, { departmentId: DEPT.FIN }))).toMatch(/^FORBIDDEN/);
  });

  it("requires authentication", async () => {
    await actAs(db, null);
    // anon has no EXECUTE privilege at all
    expect(
      await errorOf(
        db.query("select public.create_purchase_request('Desk', '', 1, 10, $1, 'Valid justification', $2::date, false)", [
          DEPT.OPS,
          futureDate(),
        ]),
      ),
    ).toMatch(/permission denied/);
  });

  it("allows the requester to edit a draft with optimistic concurrency", async () => {
    const id = await createRequest(db, USERS.employee);
    await actAs(db, USERS.employee);
    const res = await db.query<{ v: number }>(
      "select public.update_draft_request($1, 1, 'Standing desk', 'Updated', 4, '2500000.25'::numeric, $2, 'Updated justification text', $3::date) as v",
      [id, DEPT.OPS, futureDate(20)],
    );
    expect(res.rows[0].v).toBe(2);
    expect((await getRequest(id)).total_amount).toBe("10000001.00");

    await actAs(db, USERS.employee);
    const stale = await errorOf(
      db.query(
        "select public.update_draft_request($1, 1, 'Standing desk', 'Again', 4, 10, $2, 'Updated justification text', $3::date)",
        [id, DEPT.OPS, futureDate(20)],
      ),
    );
    expect(stale).toMatch(/^CONFLICT/);
  });

  it("does not let other users edit someone else's draft", async () => {
    const id = await createRequest(db, USERS.employee);
    await actAs(db, USERS.manager);
    const err = await errorOf(
      db.query(
        "select public.update_draft_request($1, 1, 'Hijack', '', 1, 1, $2, 'Hijacked justification', $3::date)",
        [id, DEPT.OPS, futureDate()],
      ),
    );
    expect(err).toMatch(/^FORBIDDEN/);
  });
});

describe("approval workflow", () => {
  it("runs draft → pending → approved and records actor + timestamp for every step", async () => {
    const id = await createRequest(db, USERS.employee);
    await actAs(db, USERS.employee);
    await db.query("select public.submit_purchase_request($1)", [id]);
    expect((await getRequest(id)).status).toBe("pending_approval");

    await actAs(db, USERS.manager);
    await db.query("select public.approve_purchase_request($1, 'Within budget')", [id]);
    const row = await getRequest(id);
    expect(row.status).toBe("approved");
    expect(row.decided_by).toBe(USERS.manager);

    const h = await history(id);
    expect(h.map((x) => [x.action, x.from_status, x.to_status, x.actor_id])).toEqual([
      ["created", null, "draft", USERS.employee],
      ["submitted", "draft", "pending_approval", USERS.employee],
      ["approved", "pending_approval", "approved", USERS.manager],
    ]);

    await actAsSuperuser(db);
    const audit = await db.query<{ count: number }>(
      "select count(*)::int as count from public.audit_logs where entity_type = 'purchase_request' and entity_id = $1",
      [id],
    );
    expect(audit.rows[0].count).toBe(3); // insert, submit, approve
  });

  it("requires a reason to reject and stores it", async () => {
    const id = await createRequest(db, USERS.employee, { submit: true });
    await actAs(db, USERS.manager);
    expect(await errorOf(db.query("select public.reject_purchase_request($1, '  ')", [id]))).toMatch(/^VALIDATION: A rejection reason/);
    expect((await getRequest(id)).status).toBe("pending_approval");

    await actAs(db, USERS.manager);
    await db.query("select public.reject_purchase_request($1, 'Duplicate of an existing order')", [id]);
    const row = await getRequest(id);
    expect(row.status).toBe("rejected");
    expect(row.decision_comment).toBe("Duplicate of an existing order");
    const last = (await history(id)).at(-1);
    expect(last).toMatchObject({ action: "rejected", actor_id: USERS.manager, comment: "Duplicate of an existing order" });
  });

  it("prevents duplicate approval submissions", async () => {
    const id = await createRequest(db, USERS.employee, { submit: true });
    await actAs(db, USERS.manager);
    await db.query("select public.approve_purchase_request($1)", [id]);
    await actAs(db, USERS.manager);
    expect(await errorOf(db.query("select public.approve_purchase_request($1)", [id]))).toMatch(/^INVALID_TRANSITION/);
    expect(await errorOf(db.query("select public.reject_purchase_request($1, 'Changed my mind')", [id]))).toMatch(
      /^INVALID_TRANSITION/,
    );
    const approvals = (await history(id)).filter((h) => h.action === "approved");
    expect(approvals).toHaveLength(1);
  });

  it("rejects invalid status transitions", async () => {
    const draft = await createRequest(db, USERS.employee);
    await actAs(db, USERS.manager);
    expect(await errorOf(db.query("select public.approve_purchase_request($1)", [draft]))).toMatch(/^INVALID_TRANSITION/);

    await actAs(db, USERS.employee);
    await db.query("select public.submit_purchase_request($1)", [draft]);
    await actAs(db, USERS.employee);
    expect(await errorOf(db.query("select public.submit_purchase_request($1)", [draft]))).toMatch(/^INVALID_TRANSITION/);

    await actAs(db, USERS.employee);
    await db.query("select public.cancel_purchase_request($1, 'No longer needed')", [draft]);
    await actAs(db, USERS.manager);
    expect(await errorOf(db.query("select public.approve_purchase_request($1)", [draft]))).toMatch(/^INVALID_TRANSITION/);
    await actAs(db, USERS.employee);
    expect(await errorOf(db.query("select public.cancel_purchase_request($1)", [draft]))).toMatch(/^INVALID_TRANSITION/);
  });

  it("blocks even privileged direct updates that skip the state machine", async () => {
    const id = await createRequest(db, USERS.employee);
    await actAsSuperuser(db);
    const err = await errorOf(
      db.query(
        "update public.purchase_requests set status = 'approved', submitted_at = now(), decided_at = now(), decided_by = $2 where id = $1",
        [id, USERS.manager],
      ),
    );
    expect(err).toMatch(/^INVALID_TRANSITION/);
  });

  it("never silently modifies approved requests", async () => {
    const id = await createRequest(db, USERS.employee, { submit: true });
    await actAs(db, USERS.manager);
    await db.query("select public.approve_purchase_request($1)", [id]);

    await actAs(db, USERS.employee);
    expect(
      await errorOf(
        db.query("select public.update_draft_request($1, 3, 'Gold chair', '', 99, 1, $2, 'Upgrade everything now', $3::date)", [
          id,
          DEPT.OPS,
          futureDate(),
        ]),
      ),
    ).toMatch(/^LOCKED/);

    // Even the database owner cannot change an approved row.
    await actAsSuperuser(db);
    expect(await errorOf(db.query("update public.purchase_requests set quantity = 99 where id = $1", [id]))).toMatch(/^LOCKED/);
    expect(await errorOf(db.query("delete from public.purchase_requests where id = $1", [id]))).toMatch(/^LOCKED/);
    expect(await errorOf(db.query("update public.approval_actions set comment = 'x' where request_id = $1", [id]))).toMatch(
      /^LOCKED/,
    );
  });

  it("locks the contents of a pending request", async () => {
    const id = await createRequest(db, USERS.employee, { submit: true });
    await actAsSuperuser(db);
    expect(await errorOf(db.query("update public.purchase_requests set unit_price = 1 where id = $1", [id]))).toMatch(/^LOCKED/);
  });
});

describe("approval permissions", () => {
  it("employees cannot approve requests", async () => {
    const id = await createRequest(db, USERS.employee2, { submit: true });
    await actAs(db, USERS.employee);
    // employee cannot even see a colleague's request → NOT_FOUND (no information leak)
    expect(await errorOf(db.query("select public.approve_purchase_request($1)", [id]))).toMatch(/^NOT_FOUND/);
    const own = await createRequest(db, USERS.employee, { submit: true });
    await actAs(db, USERS.employee);
    expect(await errorOf(db.query("select public.approve_purchase_request($1)", [own]))).toMatch(/^FORBIDDEN/);
  });

  it("managers cannot decide on other departments' requests", async () => {
    const id = await createRequest(db, USERS.employee, { submit: true });
    await actAs(db, USERS.financeManager);
    expect(await errorOf(db.query("select public.approve_purchase_request($1)", [id]))).toMatch(/^NOT_FOUND/);
  });

  it("administrators can decide across departments", async () => {
    const id = await createRequest(db, USERS.employee, { submit: true });
    await actAs(db, USERS.admin);
    await db.query("select public.approve_purchase_request($1)", [id]);
    expect((await getRequest(id)).status).toBe("approved");
  });

  it("blocks self-approval unless the business rule explicitly allows it", async () => {
    const id = await createRequest(db, USERS.manager, { submit: true });
    await actAs(db, USERS.manager);
    expect(await errorOf(db.query("select public.approve_purchase_request($1)", [id]))).toMatch(/^FORBIDDEN: You cannot approve/);

    await actAs(db, USERS.admin);
    await db.query("select public.update_app_settings('Demo Co', 'IDR', true, 95, 20, 5, 85000)");

    await actAs(db, USERS.manager);
    await db.query("select public.approve_purchase_request($1)", [id]);
    expect((await getRequest(id)).status).toBe("approved");

    await actAs(db, USERS.admin);
    await db.query("select public.update_app_settings('Demo Co', 'IDR', false, 95, 20, 5, 85000)");
  });

  it("only admins can change settings, roles and departments", async () => {
    await actAs(db, USERS.manager);
    expect(await errorOf(db.query("select public.update_app_settings('X Co', 'IDR', true, 1, 1, 1, 1)"))).toMatch(/^FORBIDDEN/);
    expect(await errorOf(db.query("select public.admin_update_profile($1, 'admin', null)", [USERS.manager]))).toMatch(/^FORBIDDEN/);
    expect(await errorOf(db.query("select public.admin_upsert_department(null, 'HACK', 'Hackers')"))).toMatch(/^FORBIDDEN/);
  });

  it("ignores roles smuggled through sign-up metadata", async () => {
    await actAsSuperuser(db);
    const res = await db.query<{ role: string }>("select role from public.profiles where id = $1", [USERS.employee]);
    expect(res.rows[0].role).toBe("employee"); // metadata said "admin"
  });
});
