import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { actAs, actAsSuperuser, createRequest, createTestDb, DEPT, errorOf, USERS } from "./harness";

let db: PGlite;
let opsRequest: string;
let opsRequest2: string;
let finRequest: string;

beforeAll(async () => {
  db = await createTestDb();
  opsRequest = await createRequest(db, USERS.employee, { submit: true, item: "Laptop" });
  opsRequest2 = await createRequest(db, USERS.employee2, { submit: true, item: "Monitor" });
  finRequest = await createRequest(db, USERS.financeEmployee, { submit: true, item: "Calculator", departmentId: DEPT.FIN });
});

afterAll(async () => {
  await db?.close();
});

async function visibleIds(userId: string | null) {
  await actAs(db, userId);
  const res = await db.query<{ id: string }>("select id from public.purchase_requests order by created_at");
  return res.rows.map((r) => r.id);
}

describe("row level security — cross-user access prevention", () => {
  it("employees only see their own requests", async () => {
    expect(await visibleIds(USERS.employee)).toEqual([opsRequest]);
    expect(await visibleIds(USERS.employee2)).toEqual([opsRequest2]);
  });

  it("managers see their own department only", async () => {
    const ids = await visibleIds(USERS.manager);
    expect(ids).toEqual(expect.arrayContaining([opsRequest, opsRequest2]));
    expect(ids).not.toContain(finRequest);
    expect(await visibleIds(USERS.financeManager)).toEqual([finRequest]);
  });

  it("administrators see all requests", async () => {
    expect(await visibleIds(USERS.admin)).toEqual(expect.arrayContaining([opsRequest, opsRequest2, finRequest]));
  });

  it("anonymous users cannot read anything", async () => {
    await actAs(db, null);
    expect(await errorOf(db.query("select * from public.purchase_requests"))).toMatch(/permission denied/);
    expect(await errorOf(db.query("select * from public.profiles"))).toMatch(/permission denied/);
  });

  it("approval history and audit logs follow request visibility", async () => {
    await actAs(db, USERS.employee);
    const actions = await db.query<{ request_id: string }>("select distinct request_id from public.approval_actions");
    expect(actions.rows.map((r) => r.request_id)).toEqual([opsRequest]);
    const audits = await db.query<{ entity_id: string; entity_type: string }>(
      "select distinct entity_type, entity_id from public.audit_logs",
    );
    expect(audits.rows).toEqual([{ entity_type: "purchase_request", entity_id: opsRequest }]);

    await actAs(db, USERS.admin);
    const all = await db.query<{ count: number }>("select count(distinct entity_type)::int as count from public.audit_logs");
    expect(all.rows[0].count).toBeGreaterThan(1); // profiles, departments, requests…
  });

  it("authenticated users cannot write tables directly", async () => {
    await actAs(db, USERS.employee);
    expect(
      await errorOf(
        db.query(
          "insert into public.purchase_requests (item_name, quantity, unit_price, department_id, justification, requester_id, required_date) values ('X', 1, 1, $1, 'Direct insert attempt', $2, current_date)",
          [DEPT.OPS, USERS.employee],
        ),
      ),
    ).toMatch(/permission denied/);
    expect(await errorOf(db.query("update public.purchase_requests set quantity = 1 where id = $1", [opsRequest]))).toMatch(
      /permission denied/,
    );
    expect(await errorOf(db.query("update public.profiles set role = 'admin' where id = $1", [USERS.employee]))).toMatch(
      /permission denied/,
    );
    expect(await errorOf(db.query("insert into public.audit_logs (entity_type, entity_id, operation) values ('x','y','INSERT')"))).toMatch(
      /permission denied/,
    );
  });

  it("internal helpers cannot be called directly", async () => {
    await actAs(db, USERS.manager);
    expect(
      await errorOf(db.query("select public.decide_purchase_request($1, 'approved', null)", [opsRequest])),
    ).toMatch(/permission denied/);
  });

  it("users cannot cancel or submit someone else's request", async () => {
    await actAs(db, USERS.employee2);
    expect(await errorOf(db.query("select public.cancel_purchase_request($1)", [opsRequest]))).toMatch(/^NOT_FOUND/);
    await actAs(db, USERS.manager);
    expect(await errorOf(db.query("select public.cancel_purchase_request($1)", [opsRequest]))).toMatch(/^FORBIDDEN/);
    await actAsSuperuser(db);
    const res = await db.query<{ status: string }>("select status from public.purchase_requests where id = $1", [opsRequest]);
    expect(res.rows[0].status).toBe("pending_approval");
  });
});
