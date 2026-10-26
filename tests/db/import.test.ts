import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { actAs, actAsSuperuser, createRequest, createTestDb, futureDate, USERS } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

type ImportResult = {
  total: number;
  valid: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  rows: { row: number; status: string; messages: string[] }[];
};

async function runImport(userId: string, rows: unknown[], dryRun: boolean): Promise<ImportResult> {
  await actAs(db, userId);
  const res = await db.query<{ result: ImportResult }>("select public.import_purchase_requests($1::jsonb, $2) as result", [
    JSON.stringify(rows),
    dryRun,
  ]);
  return res.rows[0].result;
}

const row = (over: Record<string, unknown> = {}) => ({
  request_number: null,
  item_name: "Printer toner",
  description: "Black toner cartridges",
  quantity: "4",
  unit_price: "350000.00",
  department_code: "OPS",
  justification: "Monthly printing for warehouse dispatch notes.",
  required_date: futureDate(10),
  status: "draft",
  ...over,
});

describe("CSV import (database side)", () => {
  it("dry run reports verdicts without writing anything", async () => {
    const result = await runImport(USERS.employee, [row({ request_number: "IMP-0001" })], true);
    expect(result).toMatchObject({ total: 1, valid: 1, inserted: 0, duplicates: 0, invalid: 0 });
    await actAsSuperuser(db);
    const count = await db.query<{ c: number }>("select count(*)::int c from public.purchase_requests");
    expect(count.rows[0].c).toBe(0);
  });

  it("detects duplicate request numbers and duplicate content within the file", async () => {
    const result = await runImport(
      USERS.employee,
      [
        row({ request_number: "IMP-0002", item_name: "Paper A4" }),
        row({ request_number: "IMP-0002", item_name: "Paper A3" }),
        row({ item_name: "Stapler" }),
        row({ item_name: "stapler" }), // same fingerprint, case-insensitive
      ],
      true,
    );
    expect(result.rows.map((r) => r.status)).toEqual(["valid", "duplicate", "valid", "duplicate"]);
    expect(result.duplicates).toBe(2);
  });

  it("inserts valid rows atomically, skips duplicates/invalid rows and reports them", async () => {
    const existing = await createRequest(db, USERS.employee, { item: "Existing item" });
    await actAsSuperuser(db);
    const num = (
      await db.query<{ request_number: string }>("select request_number from public.purchase_requests where id = $1", [existing])
    ).rows[0].request_number;

    const result = await runImport(
      USERS.employee,
      [
        row({ request_number: "IMP-0100", item_name: "Label printer", status: "pending_approval" }),
        row({ request_number: num, item_name: "Collides with DB" }),
        row({ item_name: "Bad qty", quantity: "abc" }),
        row({ item_name: "Wrong dept", department_code: "FIN" }),
        row({ item_name: "Unknown dept", department_code: "ZZZ" }),
        row({ item_name: "Old date", required_date: "2020-01-01" }),
        row({ item_name: "Bad status", status: "approved" }),
      ],
      false,
    );
    expect(result).toMatchObject({ total: 7, inserted: 1, duplicates: 1, invalid: 5 });
    expect(result.rows[1].messages[0]).toMatch(/already exists/);
    expect(result.rows[6].messages.join(" ")).toMatch(/Status must be draft or pending_approval/);

    await actAsSuperuser(db);
    const inserted = await db.query<{ status: string; source: string; requester_id: string }>(
      "select status, source, requester_id from public.purchase_requests where request_number = 'IMP-0100'",
    );
    expect(inserted.rows[0]).toEqual({ status: "pending_approval", source: "csv_import", requester_id: USERS.employee });
  });

  it("flags rows that duplicate the user's existing active requests", async () => {
    const first = await runImport(USERS.employee2, [row({ item_name: "Hand scanner" })], false);
    expect(first.inserted).toBe(1);
    const second = await runImport(USERS.employee2, [row({ item_name: "Hand scanner" })], false);
    expect(second).toMatchObject({ inserted: 0, duplicates: 1 });
  });

  it("rejects empty and oversized payloads", async () => {
    await actAs(db, USERS.employee);
    await expect(db.query("select public.import_purchase_requests('[]'::jsonb, true)")).rejects.toThrow(/VALIDATION/);
    const big = JSON.stringify(Array.from({ length: 501 }, () => row()));
    await expect(db.query("select public.import_purchase_requests($1::jsonb, true)", [big])).rejects.toThrow(/500 rows/);
  });
});
