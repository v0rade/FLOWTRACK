/**
 * FLOWTRACK — Database Initialization & Demo Seed Script
 *
 * Usage:
 *   npm run db:seed
 *
 * Behavior:
 *   1. If NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in
 *      .env.local / environment, seeds the remote Supabase project (creating
 *      demo auth users, profiles, departments, and sample purchase requests).
 *   2. Otherwise, initializes the embedded PostgreSQL database (PGlite), runs
 *      all migrations in supabase/migrations/*.sql plus supabase/seed.sql, and
 *      verifies the seeded Nusantara Supplies Co. demo dataset.
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  getEmbeddedPg,
  resetEmbeddedDatabase,
  withSuperuser,
} from "../src/lib/db/embedded-pg";
import { DEMO_PERSONAS } from "../src/lib/supabase/config";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

async function seedLiveSupabase(url: string, serviceRoleKey: string) {
  console.log(`Connecting to Supabase project: ${url}`);
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const departments = [
    { id: "00000000-0000-4000-8000-000000000101", code: "OPS", name: "Operations & Logistics", is_active: true },
    { id: "00000000-0000-4000-8000-000000000102", code: "IT", name: "Information Technology", is_active: true },
    { id: "00000000-0000-4000-8000-000000000103", code: "FIN", name: "Finance & Accounting", is_active: true },
    { id: "00000000-0000-4000-8000-000000000104", code: "PROC", name: "Procurement & Vendor Mgmt", is_active: true },
    { id: "00000000-0000-4000-8000-000000000105", code: "HR", name: "People & Workplace Operations", is_active: true },
  ];

  const { error: deptErr } = await admin.from("departments").upsert(departments);
  if (deptErr) throw new Error(`Failed to upsert departments: ${deptErr.message}`);
  console.log(`✓ Upserted ${departments.length} departments.`);

  const deptByCode = new Map(departments.map((d) => [d.code, d.id]));
  const demoPassword = process.env.DEMO_USER_PASSWORD || "FlowtrackDemo#2026";

  for (const persona of DEMO_PERSONAS) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: persona.email,
      password: demoPassword,
      email_confirm: true,
      user_metadata: { full_name: persona.full_name },
    });

    let userId = created?.user?.id;
    if (createErr && !userId) {
      const { data: list } = await admin.auth.admin.listUsers();
      userId = list?.users.find((u) => u.email?.toLowerCase() === persona.email.toLowerCase())?.id;
    }

    if (userId) {
      await admin
        .from("profiles")
        .update({
          role: persona.role,
          department_id: deptByCode.get(persona.department_code) ?? null,
          full_name: persona.full_name,
        })
        .eq("id", userId);
      console.log(`✓ Provisioned ${persona.full_name} (${persona.role} · ${persona.department_code})`);
    }
  }

  console.log(
    "✓ Live Supabase auth & profile seed complete. To load the 16 historical purchase requests with exact timestamps, run supabase/seed.sql in the Supabase SQL Editor.",
  );
}

async function seedEmbedded() {
  console.log("Initializing embedded PostgreSQL (PGlite) with migrations + supabase/seed.sql...");
  await getEmbeddedPg();
  await resetEmbeddedDatabase();

  await withSuperuser(async (db) => {
    const counts = await db.query<{
      depts: number;
      profiles: number;
      requests: number;
      actions: number;
      audits: number;
    }>(`
      select
        (select count(*)::int from public.departments) as depts,
        (select count(*)::int from public.profiles) as profiles,
        (select count(*)::int from public.purchase_requests) as requests,
        (select count(*)::int from public.approval_actions) as actions,
        (select count(*)::int from public.audit_logs) as audits
    `);

    const row = counts.rows[0];
    console.log("✓ Embedded PostgreSQL initialized and seeded:");
    console.log(`  • Departments:       ${row.depts}`);
    console.log(`  • User Profiles:     ${row.profiles}`);
    console.log(`  • Purchase Requests: ${row.requests}`);
    console.log(`  • Approval Actions:  ${row.actions}`);
    console.log(`  • Audit Log Entries: ${row.audits}`);
  });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (
    url &&
    serviceKey &&
    url.startsWith("http") &&
    !url.includes("your-project-ref.supabase.co") &&
    serviceKey !== "your-service-role-key"
  ) {
    await seedLiveSupabase(url, serviceKey);
  } else {
    await seedEmbedded();
  }
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
