import type { Role } from "@/lib/types";

export interface DemoPersona {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  department_code: string;
  department_name: string;
  badge: string;
  summary: string;
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    email: "rina.wijaya@nusantara-demo.id",
    full_name: "Rina Wijaya",
    role: "employee",
    department_code: "OPS",
    department_name: "Operations & Logistics",
    badge: "Employee · OPS",
    summary: "Creates & submits Operations purchase requests; views only her own requests.",
  },
  {
    id: "00000000-0000-4000-8000-000000000204",
    email: "budi.santoso@nusantara-demo.id",
    full_name: "Budi Santoso",
    role: "manager",
    department_code: "OPS",
    department_name: "Operations & Logistics",
    badge: "Manager · OPS",
    summary: "Reviews, approves, or rejects Operations requests; cannot see IT or Finance requests.",
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    email: "dimas.pratama@nusantara-demo.id",
    full_name: "Dimas Pratama",
    role: "employee",
    department_code: "IT",
    department_name: "Information Technology",
    badge: "Employee · IT",
    summary: "Creates & submits IT infrastructure requests; isolated from Operations data by RLS.",
  },
  {
    id: "00000000-0000-4000-8000-000000000205",
    email: "hendra.kusuma@nusantara-demo.id",
    full_name: "Hendra Kusuma",
    role: "manager",
    department_code: "IT",
    department_name: "Information Technology",
    badge: "Manager · IT",
    summary: "Approves or rejects IT department requests.",
  },
  {
    id: "00000000-0000-4000-8000-000000000206",
    email: "nadia.putri@nusantara-demo.id",
    full_name: "Nadia Putri",
    role: "admin",
    department_code: "FIN",
    department_name: "Finance & Accounting",
    badge: "Administrator · All Depts",
    summary: "Full cross-department visibility, approvals, audit logs, roles, and ROI assumptions.",
  },
] as const;

export const DEMO_SESSION_COOKIE = "flowtrack_demo_uid";
export const DEFAULT_DEMO_USER_ID = DEMO_PERSONAS[0].id; // Rina Wijaya (Employee · OPS)

/**
 * Returns true when a live external Supabase project is configured via
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (and embedded mode
 * is not explicitly forced).
 */
export function isLiveSupabaseConfigured(): boolean {
  if (process.env.FLOWTRACK_USE_EMBEDDED_DB === "true") {
    return false;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return Boolean(
    url &&
      key &&
      url.startsWith("http") &&
      !url.includes("your-project-ref.supabase.co") &&
      key !== "your-anon-key",
  );
}
