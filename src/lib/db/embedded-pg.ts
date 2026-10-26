import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

declare global {
  var __flowtrackEmbeddedPgPromise: Promise<PGlite> | undefined;
  var __flowtrackEmbeddedPgMutex: Promise<unknown> | undefined;
}

const SUPABASE_STUB_SQL = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text not null unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

async function bootEmbeddedPg(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB_SQL);

  const root = process.cwd();
  const migrationsDir = path.join(root, "supabase", "migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await db.exec(sql);
  }

  const seedPath = path.join(root, "supabase", "seed.sql");
  const seedSql = readFileSync(seedPath, "utf8");
  await db.exec(seedSql);

  return db;
}

export function getEmbeddedPg(): Promise<PGlite> {
  if (!globalThis.__flowtrackEmbeddedPgPromise) {
    globalThis.__flowtrackEmbeddedPgPromise = bootEmbeddedPg();
  }
  return globalThis.__flowtrackEmbeddedPgPromise;
}

/**
 * Serializes access to the embedded PostgreSQL connection and sets the
 * caller's Supabase JWT claim + role (`authenticated` or `anon`) so that
 * Row Level Security policies and `auth.uid()` behave identically to Supabase.
 */
export async function withAsUser<T>(
  userId: string | null,
  fn: (db: PGlite) => Promise<T>,
): Promise<T> {
  const prev = globalThis.__flowtrackEmbeddedPgMutex ?? Promise.resolve();
  let release!: () => void;
  globalThis.__flowtrackEmbeddedPgMutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  await prev.catch(() => undefined);

  try {
    const db = await getEmbeddedPg();
    const claims = userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "";
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
    await db.exec(userId ? "set role authenticated;" : "set role anon;");
    try {
      return await fn(db);
    } finally {
      await db.exec("reset role;");
      await db.query("select set_config('request.jwt.claims', '', false)");
    }
  } finally {
    release();
  }
}

/** Execute a privileged operation (used only for auth sign-in lookup / demo reset). */
export async function withSuperuser<T>(fn: (db: PGlite) => Promise<T>): Promise<T> {
  const prev = globalThis.__flowtrackEmbeddedPgMutex ?? Promise.resolve();
  let release!: () => void;
  globalThis.__flowtrackEmbeddedPgMutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  await prev.catch(() => undefined);

  try {
    const db = await getEmbeddedPg();
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claims', '', false)");
    return await fn(db);
  } finally {
    release();
  }
}

export async function resetEmbeddedDatabase(): Promise<void> {
  await withSuperuser(async (db) => {
    await db.close();
  });
  globalThis.__flowtrackEmbeddedPgPromise = bootEmbeddedPg();
  await globalThis.__flowtrackEmbeddedPgPromise;
}

export async function findOrCreateDemoAccount(params: {
  email: string;
  fullName?: string;
  createIfMissing?: boolean;
}): Promise<{ id: string; email: string } | null> {
  const normalized = params.email.trim().toLowerCase();
  return withSuperuser(async (db) => {
    const existing = await db.query<{ id: string; email: string }>(
      "select id, email from public.profiles where lower(email) = $1 limit 1",
      [normalized],
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }
    if (!params.createIfMissing) {
      return null;
    }
    const newId = crypto.randomUUID();
    const opsDept = "00000000-0000-4000-8000-000000000101";
    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
      [newId, normalized, JSON.stringify({ full_name: params.fullName || normalized.split("@")[0] })],
    );
    await db.query("update public.profiles set department_id = $2 where id = $1", [newId, opsDept]);
    return { id: newId, email: normalized };
  });
}
