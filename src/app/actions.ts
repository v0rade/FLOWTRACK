"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  adminProfileSchema,
  approveSchema,
  cancelSchema,
  createRequestSchema,
  credentialsSchema,
  departmentSchema,
  fieldErrors,
  profileUpdateSchema,
  rejectSchema,
  requestIdSchema,
  settingsSchema,
  signUpSchema,
  updateDraftSchema,
} from "@/lib/validation";
import {
  dbAdminUpdateProfile,
  dbAdminUpsertDepartment,
  dbApprovePurchaseRequest,
  dbCancelPurchaseRequest,
  dbCreatePurchaseRequest,
  dbImportPurchaseRequests,
  dbRejectPurchaseRequest,
  dbSubmitPurchaseRequest,
  dbUpdateAppSettings,
  dbUpdateDraftRequest,
  dbUpdateOwnProfile,
  friendlyDbError,
  getRequestWithHistory,
  type DbImportResult,
  type EnrichedApprovalAction,
  type EnrichedAuditLog,
  type EnrichedPurchaseRequest,
  type ImportRowInput,
} from "@/lib/data";
import {
  DEMO_PERSONAS,
  DEMO_SESSION_COOKIE,
  isLiveSupabaseConfigured,
} from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  findOrCreateDemoAccount,
  resetEmbeddedDatabase,
} from "@/lib/db/embedded-pg";
import type { ActionResult } from "@/lib/types";

function revalidateAll() {
  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/requests");
  revalidatePath("/approvals");
  revalidatePath("/reports");
  revalidatePath("/settings");
}

// =============================================================================
// Authentication & Demo Persona Actions
// =============================================================================

export async function switchDemoPersonaAction(personaId: string): Promise<ActionResult<{ id: string }>> {
  const persona = DEMO_PERSONAS.find((p) => p.id === personaId);
  if (!persona) {
    return { ok: false, error: "Unknown demo persona." };
  }
  const cookieStore = await cookies();
  cookieStore.set(DEMO_SESSION_COOKIE, persona.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  revalidateAll();
  return {
    ok: true,
    data: { id: persona.id },
    message: `Switched active session to ${persona.full_name} (${persona.badge}).`,
  };
}

export async function signInAction(input: {
  email: string;
  password: string;
}): Promise<ActionResult<{ userId: string }>> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please enter a valid email and password.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error || !data.user) {
      return { ok: false, error: error?.message ?? "Invalid login credentials." };
    }
    revalidateAll();
    return { ok: true, data: { userId: data.user.id }, message: "Signed in." };
  }

  const account = await findOrCreateDemoAccount({
    email: parsed.data.email,
    createIfMissing: false,
  });
  if (!account) {
    return {
      ok: false,
      error: "No account found with that email. Use one of the demo accounts or sign up first.",
    };
  }
  const cookieStore = await cookies();
  cookieStore.set(DEMO_SESSION_COOKIE, account.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  revalidateAll();
  return { ok: true, data: { userId: account.id }, message: "Signed in to demo workspace." };
}

export async function signUpAction(input: {
  full_name: string;
  email: string;
  password: string;
}): Promise<ActionResult<{ userId: string }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.full_name } },
    });
    if (error || !data.user) {
      return { ok: false, error: error?.message ?? "Could not create account." };
    }
    revalidateAll();
    return {
      ok: true,
      data: { userId: data.user.id },
      message: "Account created with Employee permissions.",
    };
  }

  const account = await findOrCreateDemoAccount({
    email: parsed.data.email,
    fullName: parsed.data.full_name,
    createIfMissing: true,
  });
  if (!account) {
    return { ok: false, error: "Unable to create account." };
  }
  const cookieStore = await cookies();
  cookieStore.set(DEMO_SESSION_COOKIE, account.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  revalidateAll();
  return {
    ok: true,
    data: { userId: account.id },
    message: "Account created with Employee permissions.",
  };
}

export async function signOutAction(): Promise<ActionResult> {
  if (isLiveSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } else {
    const cookieStore = await cookies();
    cookieStore.set(DEMO_SESSION_COOKIE, "signed_out", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  revalidateAll();
  return { ok: true, data: undefined, message: "Signed out." };
}

export async function resetDemoDataAction(): Promise<ActionResult> {
  if (isLiveSupabaseConfigured()) {
    return {
      ok: false,
      error: "Demo database reset via UI is only available in embedded demo mode. Run npm run db:seed for external Supabase.",
    };
  }
  try {
    await resetEmbeddedDatabase();
    revalidateAll();
    return {
      ok: true,
      data: undefined,
      message: "Demo database reset to initial Nusantara Supplies Co. scenario.",
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

// =============================================================================
// Purchase Request & Approval Workflow Actions
// =============================================================================

export async function createPurchaseRequestAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted form fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    const id = await dbCreatePurchaseRequest({
      item_name: parsed.data.item_name,
      description: parsed.data.description,
      quantity: Number(parsed.data.quantity),
      unit_price: parsed.data.unit_price,
      department_id: parsed.data.department_id,
      justification: parsed.data.justification,
      required_date: parsed.data.required_date,
      submit: parsed.data.submit,
    });
    revalidateAll();
    return {
      ok: true,
      data: { id },
      message: parsed.data.submit
        ? "Purchase request created and submitted for manager approval."
        : "Draft purchase request saved.",
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

export async function updateDraftRequestAction(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  const parsed = updateDraftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted form fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    const version = await dbUpdateDraftRequest({
      id: parsed.data.id,
      expected_version: parsed.data.version,
      item_name: parsed.data.item_name,
      description: parsed.data.description,
      quantity: Number(parsed.data.quantity),
      unit_price: parsed.data.unit_price,
      department_id: parsed.data.department_id,
      justification: parsed.data.justification,
      required_date: parsed.data.required_date,
    });
    revalidateAll();
    return {
      ok: true,
      data: { version },
      message: "Draft updated.",
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

export async function submitPurchaseRequestAction(id: string): Promise<ActionResult> {
  const parsed = requestIdSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request identifier." };
  }

  try {
    await dbSubmitPurchaseRequest(parsed.data);
    revalidateAll();
    return {
      ok: true,
      data: undefined,
      message: "Request submitted for manager approval.",
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

export async function approvePurchaseRequestAction(input: {
  id: string;
  comment?: string;
}): Promise<ActionResult> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid approval payload.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    await dbApprovePurchaseRequest(parsed.data.id, parsed.data.comment);
    revalidateAll();
    return {
      ok: true,
      data: undefined,
      message: "Purchase request approved and locked.",
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

export async function rejectPurchaseRequestAction(input: {
  id: string;
  reason: string;
}): Promise<ActionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "A rejection reason is required.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    await dbRejectPurchaseRequest(parsed.data.id, parsed.data.reason);
    revalidateAll();
    return {
      ok: true,
      data: undefined,
      message: "Purchase request rejected and reason recorded in audit history.",
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

export async function cancelPurchaseRequestAction(input: {
  id: string;
  reason?: string;
}): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid cancellation request.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    await dbCancelPurchaseRequest(parsed.data.id, parsed.data.reason);
    revalidateAll();
    return {
      ok: true,
      data: undefined,
      message: "Purchase request cancelled.",
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

export async function fetchRequestDetailAction(requestId: string): Promise<
  ActionResult<{
    request: EnrichedPurchaseRequest;
    actions: EnrichedApprovalAction[];
    audits: EnrichedAuditLog[];
  }>
> {
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request identifier." };
  }
  try {
    const detail = await getRequestWithHistory(parsed.data);
    if (!detail) {
      return { ok: false, error: "Purchase request not found or you are not authorized to view it." };
    }
    return { ok: true, data: detail };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

// =============================================================================
// CSV Import Actions (Dry-Run Validation + Transactional Commit)
// =============================================================================

export async function importPurchaseRequestsAction(input: {
  rows: ImportRowInput[];
  dryRun: boolean;
}): Promise<ActionResult<DbImportResult>> {
  if (!Array.isArray(input?.rows) || input.rows.length === 0) {
    return { ok: false, error: "No rows provided for import." };
  }
  try {
    const result = await dbImportPurchaseRequests(input.rows, Boolean(input.dryRun));
    if (!input.dryRun) {
      revalidateAll();
    }
    return {
      ok: true,
      data: result,
      message: input.dryRun
        ? `Validated ${result.total} row(s): ${result.valid} ready, ${result.duplicates} duplicate, ${result.invalid} invalid.`
        : `Imported ${result.inserted} purchase request(s) (${result.duplicates} duplicate and ${result.invalid} invalid skipped).`,
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

// =============================================================================
// Profile & Administration Actions
// =============================================================================

export async function updateOwnProfileAction(input: { full_name: string }): Promise<ActionResult> {
  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please enter a valid name.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  try {
    await dbUpdateOwnProfile(parsed.data.full_name);
    revalidateAll();
    return { ok: true, data: undefined, message: "Profile updated." };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

export async function adminUpdateProfileAction(input: unknown): Promise<ActionResult> {
  const parsed = adminProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid profile role or department.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  try {
    await dbAdminUpdateProfile(parsed.data);
    revalidateAll();
    return { ok: true, data: undefined, message: "User role and department updated." };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

export async function adminUpsertDepartmentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = departmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please check the department code and name.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  try {
    const id = await dbAdminUpsertDepartment(parsed.data);
    revalidateAll();
    return {
      ok: true,
      data: { id },
      message: parsed.data.id ? "Department updated." : "Department created.",
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}

export async function updateAppSettingsAction(input: unknown): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted settings fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  try {
    await dbUpdateAppSettings(parsed.data);
    revalidateAll();
    return {
      ok: true,
      data: undefined,
      message: "Organization rules and ROI baseline assumptions saved.",
    };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  }
}
