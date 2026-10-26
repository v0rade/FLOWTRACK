import { z } from "zod";
import { isValidMoney, lineTotalCents, parseMoneyToCents, tryParseMoneyToCents } from "./money";

/** YYYY-MM-DD in UTC for a date offset by `days` from now. */
export function isoDate(days = 0, from: Date = new Date()): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TOTAL_CENTS = 9_999_999_999_999n; // 99,999,999,999.99

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const requiredDateSchema = z
  .string()
  .trim()
  .refine(isRealDate, "Use a valid date (YYYY-MM-DD).")
  .refine((v) => v >= isoDate(-1), "Required date cannot be in the past.")
  .refine((v) => v <= isoDate(730), "Required date must be within the next two years.");

export const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Quantity must be a whole number.")
  .refine((v) => Number(v) >= 1 && Number(v) <= 100_000, "Quantity must be between 1 and 100,000.");

export const unitPriceSchema = z
  .string()
  .trim()
  .refine(isValidMoney, "Enter an amount with at most 2 decimals (e.g. 1250000 or 1250000.50).")
  .refine((v) => {
    const cents = tryParseMoneyToCents(v);
    return cents === null || cents <= 1_000_000_000_000n;
  }, "Unit price is too large.");

/** Purchase request form — shared by the browser (React Hook Form) and the server action. */
export const requestFormSchema = z
  .object({
    item_name: z.string().trim().min(2, "Item name must be at least 2 characters.").max(120, "Item name is too long."),
    description: z.string().trim().max(2000, "Description must be 2000 characters or fewer."),
    quantity: quantitySchema,
    unit_price: unitPriceSchema,
    department_id: z.guid("Select a department."),
    justification: z
      .string()
      .trim()
      .min(10, "Explain the business need in at least 10 characters.")
      .max(2000, "Justification must be 2000 characters or fewer."),
    required_date: requiredDateSchema,
  })
  .superRefine((value, ctx) => {
    if (!/^\d+$/.test(value.quantity) || !isValidMoney(value.unit_price)) return;
    const total = lineTotalCents(Number(value.quantity), parseMoneyToCents(value.unit_price));
    if (total > MAX_TOTAL_CENTS) {
      ctx.addIssue({ code: "custom", path: ["unit_price"], message: "Request total exceeds the maximum allowed amount." });
    }
  });

export type RequestFormValues = z.infer<typeof requestFormSchema>;

export const createRequestSchema = requestFormSchema.and(z.object({ submit: z.boolean() }));

export const updateDraftSchema = requestFormSchema.and(
  z.object({ id: z.guid(), version: z.number().int().min(1) }),
);

export const requestIdSchema = z.guid("Invalid request id.");

export const approveSchema = z.object({
  id: z.guid(),
  comment: z.string().trim().max(1000, "Comment must be 1000 characters or fewer.").optional(),
});

export const rejectSchema = z.object({
  id: z.guid(),
  reason: z
    .string()
    .trim()
    .min(5, "Please give a rejection reason (at least 5 characters).")
    .max(1000, "Reason must be 1000 characters or fewer."),
});

export const cancelSchema = z.object({
  id: z.guid(),
  reason: z.string().trim().max(1000, "Reason must be 1000 characters or fewer.").optional(),
});

export const settingsSchema = z.object({
  organization_name: z.string().trim().min(2).max(120),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code."),
  allow_self_approval: z.boolean(),
  manual_minutes_per_request: z.number().int().min(1).max(10_000),
  digital_minutes_per_request: z.number().int().min(1).max(10_000),
  manual_cycle_days: z.number().gt(0).max(365),
  hourly_staff_cost: z.string().trim().refine(isValidMoney, "Enter a valid amount."),
});

export type SettingsValues = z.infer<typeof settingsSchema>;

export const profileUpdateSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required.").max(120),
});

export const adminProfileSchema = z.object({
  user_id: z.guid(),
  role: z.enum(["employee", "manager", "admin"]),
  department_id: z.guid().nullable(),
});

export const departmentSchema = z.object({
  id: z.guid().nullable(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, "Code must be 2-10 letters or digits."),
  name: z.string().trim().min(2).max(80),
  is_active: z.boolean(),
});

export const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const signUpSchema = credentialsSchema.extend({
  full_name: z.string().trim().min(2, "Enter your full name.").max(120),
});

/** Flatten zod issues to { field: [messages] } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
