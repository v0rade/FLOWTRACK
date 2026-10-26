import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");
const migrationsDir = path.join(root, "supabase", "migrations");

export const DEPT = {
  OPS: "00000000-0000-4000-8000-0000000000d1",
  FIN: "00000000-0000-4000-8000-0000000000d2",
} as const;

export const USERS = {
  employee: "00000000-0000-4000-8000-000000000001", // OPS employee
  employee2: "00000000-0000-4000-8000-000000000002", // OPS employee
  manager: "00000000-0000-4000-8000-000000000003", // OPS manager
  financeManager: "00000000-0000-4000-8000-000000000004", // FIN manager
  admin: "00000000-0000-4000-8000-000000000005", // admin (FIN)
  financeEmployee: "00000000-0000-4000-8000-000000000006", // FIN employee
} as const;

/**
 * Creates an isolated, in-memory PostgreSQL database (PGlite), applies a small
 * Supabase stub (roles + auth.uid()) and then every FLOWTRACK migration in
 * order. Nothing touches a real Supabase project.
 */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(__dirname, "supabase-stub.sql"), "utf8"));
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  await seedFixtures(db);
  return db;
}

async function seedFixtures(db: PGlite) {
  await db.exec(`
    insert into public.departments (id, code, name) values
      ('${DEPT.OPS}', 'OPS', 'Operations'),
      ('${DEPT.FIN}', 'FIN', 'Finance');

    insert into auth.users (id, email, raw_user_meta_data) values
      ('${USERS.employee}', 'emma@test.local', '{"full_name":"Emma Employee","role":"admin"}'),
      ('${USERS.employee2}', 'eli@test.local', '{"full_name":"Eli Employee"}'),
      ('${USERS.manager}', 'mona@test.local', '{"full_name":"Mona Manager"}'),
      ('${USERS.financeManager}', 'fred@test.local', '{"full_name":"Fred Finance"}'),
      ('${USERS.admin}', 'ada@test.local', '{"full_name":"Ada Admin"}'),
      ('${USERS.financeEmployee}', 'fay@test.local', '{"full_name":"Fay Finance"}');

    update public.profiles set department_id = '${DEPT.OPS}' where id in ('${USERS.employee}', '${USERS.employee2}');
    update public.profiles set role = 'manager', department_id = '${DEPT.OPS}' where id = '${USERS.manager}';
    update public.profiles set role = 'manager', department_id = '${DEPT.FIN}' where id = '${USERS.financeManager}';
    update public.profiles set role = 'admin', department_id = '${DEPT.FIN}' where id = '${USERS.admin}';
    update public.profiles set department_id = '${DEPT.FIN}' where id = '${USERS.financeEmployee}';
  `);
}

/** Switch the session to an authenticated Supabase user (RLS applies). */
export async function actAs(db: PGlite, userId: string | null) {
  const claims = userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "";
  await db.exec("reset role;");
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec(userId ? "set role authenticated;" : "set role anon;");
}

/** Return to the superuser session (bypasses RLS) for assertions/setup. */
export async function actAsSuperuser(db: PGlite) {
  await db.exec("reset role;");
  await db.query("select set_config('request.jwt.claims', '', false)");
}

export function futureDate(days = 14): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function createRequest(
  db: PGlite,
  userId: string,
  overrides: Partial<{
    item: string;
    quantity: number;
    unitPrice: string;
    departmentId: string;
    submit: boolean;
    requiredDate: string;
  }> = {},
): Promise<string> {
  await actAs(db, userId);
  const res = await db.query<{ id: string }>(
    `select public.create_purchase_request($1, $2, $3, $4::numeric, $5, $6, $7::date, $8) as id`,
    [
      overrides.item ?? "Ergonomic chair",
      "Test description",
      overrides.quantity ?? 2,
      overrides.unitPrice ?? "1250000.50",
      overrides.departmentId ?? DEPT.OPS,
      "Needed to replace broken office chairs in the ops room.",
      overrides.requiredDate ?? futureDate(),
      overrides.submit ?? false,
    ],
  );
  return res.rows[0].id;
}

/** Runs a query and returns the error message (or null if it succeeded). */
export async function errorOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
