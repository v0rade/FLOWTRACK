# FLOWTRACK — Smart Business Operations Dashboard

**FLOWTRACK** is a full-stack business operations application demonstrating how an organization can digitize internal purchase requests, enforce role-based approval workflows inside PostgreSQL transactions, centralize audit logs, and measure process efficiency.

> **Portfolio Attribution & Data Disclaimer:**
> FLOWTRACK is an independent portfolio project inspired by the digital transformation principles described in the Cerlang Digital 2026 company profile. **It is not an official Cerlang Digital product.** All pre-loaded records (*Nusantara Supplies Co. (Demo)*) are fictional sample data; estimated efficiency gains in the Before-and-After comparison panel are derived from configurable illustrative assumptions and never claimed as actual customer results.

---

## 1. Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | Next.js 16.4 App Router (React 19, Server Components, Server Actions, Route Handlers) |
| **Language** | TypeScript 5 (strict mode) |
| **Styling & UI** | Tailwind CSS v4, shadcn/ui, Lucide Icons, Sonner notifications |
| **Forms & Validation** | React Hook Form + Zod v4 (shared client & server validation schemas) |
| **Database & Security** | Supabase PostgreSQL (`@supabase/ssr`, `@supabase/supabase-js`) with Row Level Security (RLS), `NUMERIC` generated columns, and transactional `SECURITY DEFINER` RPCs; includes an automatic zero-config embedded PostgreSQL engine (`@electric-sql/pglite`) for instant local & portfolio demos |
| **Analytics & Charts** | Recharts 3 + BigInt decimal-safe aggregation |
| **CSV Import / Export** | PapaParse + formula-injection-safe CSV serializer |
| **Automated Testing** | Vitest + isolated in-memory PostgreSQL (`@electric-sql/pglite`) |

---

## 2. Core Features & Architecture

### Purchase Request Management
- **Server-Calculated Decimal Totals:** `unit_price` is stored as `NUMERIC(15,2)` and `total_amount` is a PostgreSQL `GENERATED ALWAYS AS (quantity * unit_price) STORED` `NUMERIC(18,2)` column. Client previews and KPI aggregations use `BigInt` minor-unit (cents) arithmetic (`src/lib/money.ts`) so binary floating-point drift never occurs.
- **Full Lifecycle Support:** Supports `draft`, `pending_approval`, `approved`, `rejected`, and `cancelled` statuses with auto-generated sequential request numbers (`PR-YYYY-NNNNN`).
- **Optimistic Concurrency & Immutability:** Editing a draft checks `version` (`40001 CONFLICT` on stale writes). Once a request reaches `approved`, `rejected`, or `cancelled`, database `BEFORE UPDATE` and `BEFORE DELETE` triggers permanently lock the row.

### Transactional Approval Workflow & Row Level Security
- **Database-Enforced State Machine:** `public.is_valid_status_transition()` and `BEFORE UPDATE` triggers prevent invalid transitions or duplicate approvals (`SELECT ... FOR UPDATE` row locking in `public.decide_purchase_request()`).
- **Mandatory Rejection Reasons:** Rejecting a request requires a reason of at least 5 characters, enforced by both Zod (`rejectSchema`), the PostgreSQL `decide_purchase_request` function, and a table `CHECK` constraint.
- **Self-Approval Prevention:** Users cannot approve or reject their own requests (`requester_id = auth.uid()`) unless an Administrator explicitly enables `allow_self_approval` in `public.app_settings`.
- **Append-Only History & Audit Trail:** `AFTER INSERT OR UPDATE` triggers automatically record every workflow step in `public.approval_actions` and every field-level change in `public.audit_logs`. Both tables have `BEFORE UPDATE OR DELETE` triggers that block any mutation.
- **Strict Row Level Security (RLS):**
  - Authenticated users have `SELECT`-only table grants filtered by `public.can_view_request(requester_id, department_id)`:
    - **Employees** see only requests they created.
    - **Managers** see requests belonging to their assigned department.
    - **Administrators** see all departments, settings, and system-wide audit logs.
  - All writes execute exclusively through authorized PostgreSQL RPC functions (`create_purchase_request`, `update_draft_request`, `submit_purchase_request`, `approve_purchase_request`, `reject_purchase_request`, `cancel_purchase_request`, `import_purchase_requests`).

### KPI Analytics & Before-and-After Process Comparison
- **Live KPIs from Stored Records:** Total requests, pending approvals, approved requests, rejected requests, total requested spending, total approved spending, measured average approval turnaround time (`submitted_at` → `decided_at`), and approval completion rate.
- **4 Interactive Charts:** Requests by Month, Requested vs. Approved Spending, Requests by Department, and Approval Status Distribution, with live Date and Department filters.
- **Before-and-After Process Comparison Panel:** Contrasts manual paper/spreadsheet handling against FLOWTRACK using configurable illustrative assumptions (`manual_minutes_per_request`, `digital_minutes_per_request`, `manual_cycle_days`, `hourly_staff_cost`), visually separating **Estimated Savings (Illustrative Model)** from **Measured Results (Stored DB Timestamps)**.

### CSV Batch Import & Export
- **Import Workbench:** Validates required columns (`item_name, quantity, unit_price, department_code, justification, required_date`), previews rows, detects in-file and database duplicates via dry-run RPC (`import_purchase_requests(rows, true)`), downloads a CSV Error Report for rejected rows, and commits valid rows atomically.
- **Formula-Safe Export:** `/api/requests/export` exports only records visible to the authenticated user under RLS and prefixes leading `=`, `+`, `-`, `@` formula characters to prevent spreadsheet injection.

---

## 3. Project Structure

```text
flowtrack/
├── supabase/
│   ├── migrations/
│   │   ├── 20261025000100_schema.sql     # Core tables, constraints, NUMERIC generated column, indexes
│   │   ├── 20261025000200_workflow.sql   # State machine triggers, audit triggers, transactional RPCs
│   │   └── 20261025000300_security.sql   # Row Level Security policies & strict privilege grants
│   └── seed.sql                          # Fictional Nusantara Supplies Co. demo dataset
├── scripts/
│   └── seed.ts                           # CLI seed runner for Supabase or embedded PostgreSQL
├── src/
│   ├── app/
│   │   ├── api/requests/export/route.ts  # Authorized CSV export & template download endpoint
│   │   ├── approvals/page.tsx            # Approval workflow queue page
│   │   ├── login/page.tsx                # Auth sign-in / registration + 1-click demo persona login
│   │   ├── reports/page.tsx              # Executive spend & process efficiency reports page
│   │   ├── requests/page.tsx             # Purchase requests register (search, filter, sort, paginate)
│   │   ├── settings/page.tsx             # Governance rules, RBAC directory, departments & audit log
│   │   ├── actions.ts                    # Next.js Server Actions (Zod-validated + DB RPCs)
│   │   └── page.tsx                      # Operations Overview & KPI Analytics dashboard
│   ├── components/flowtrack/             # Enterprise UI components, dialogs, drawers & charts
│   └── lib/
│       ├── db/embedded-pg.ts             # Embedded PostgreSQL (PGlite) singleton with RLS context
│       ├── supabase/                     # @supabase/ssr client, server, and persona config
│       ├── analytics.ts                  # Pure KPI, chart series & ROI comparison calculators
│       ├── csv.ts                        # CSV parser, duplicate detector & formula-safe writer
│       ├── data.ts                       # Unified server data & RPC layer
│       ├── money.ts                      # BigInt cents decimal-safe monetary utilities
│       ├── types.ts                      # Domain TypeScript interfaces
│       ├── validation.ts                 # Shared Zod v4 validation schemas
│       └── workflow.ts                   # Status transition & permission helpers
└── tests/
    ├── db/                               # PostgreSQL migration, RLS, workflow, import & scenario tests
    └── unit/                             # Money, validation, workflow, CSV & analytics unit tests
```

---

## 4. Local Setup & Development

### Prerequisites
- **Node.js** 20+ (tested on Node v24.21.0)
- **npm** 10+

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables (Optional for Local Demo)
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

- **Zero-Config Embedded PostgreSQL Mode (Default):** If you leave `.env.local` with placeholder values (or do not create `.env.local`), FLOWTRACK automatically boots an embedded PostgreSQL instance (`@electric-sql/pglite`) on the server, executes all migrations in `supabase/migrations/*.sql`, enables Row Level Security, and seeds the *Nusantara Supplies Co.* demo dataset (`supabase/seed.sql`). You can switch between 5 demo personas (**Employee · OPS**, **Manager · OPS**, **Employee · IT**, **Manager · IT**, **Administrator**) from the top bar at any time.
- **External Supabase Mode:** Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` to connect to your Supabase Cloud or `supabase start` instance.

### 3. Initialize / Verify Database Seed
```bash
npm run db:seed
```
- When connected to an external Supabase project (with `SUPABASE_SERVICE_ROLE_KEY`), apply the SQL files in `supabase/migrations/` in order via the Supabase SQL Editor or `supabase db push`, then run `npm run db:seed` and `supabase/seed.sql`.

### 4. Start the Development Server
```bash
npm run dev
```
Open `http://localhost:3000`.

---

## 5. Quality Verification & Automated Tests

Run the full verification suite:

```bash
# 1. ESLint static analysis
npm run lint

# 2. TypeScript compiler check
npm run typecheck

# 3. Automated unit & isolated PostgreSQL integration tests (Vitest + PGlite)
npm test

# 4. Production build
npm run build
```

---

## 6. Deployment

1. Provision a PostgreSQL project on [Supabase](https://supabase.com).
2. Run the three migration files in `supabase/migrations/` (`20261025000100_schema.sql`, `20261025000200_workflow.sql`, `20261025000300_security.sql`) and optionally `supabase/seed.sql`.
3. Deploy the Next.js repository to **Vercel** (or any Node.js container host) and configure:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - (Or set `FLOWTRACK_USE_EMBEDDED_DB=true` for a self-contained portfolio showcase deployment).
