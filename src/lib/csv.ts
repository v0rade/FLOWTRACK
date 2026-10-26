import Papa from "papaparse";
import { z } from "zod";
import { quantitySchema, requiredDateSchema, unitPriceSchema } from "./validation";
import { lineTotalCents, parseMoneyToCents } from "./money";

export const CSV_REQUIRED_COLUMNS = [
  "item_name",
  "quantity",
  "unit_price",
  "department_code",
  "justification",
  "required_date",
] as const;
export const CSV_OPTIONAL_COLUMNS = ["request_number", "description", "status"] as const;
export const CSV_ALL_COLUMNS = [...CSV_OPTIONAL_COLUMNS.slice(0, 1), ...CSV_REQUIRED_COLUMNS, "description", "status"] as const;

export const CSV_MAX_ROWS = 500;
export const CSV_MAX_BYTES = 1_000_000;

const HEADER_ALIASES: Record<string, string> = {
  item: "item_name",
  name: "item_name",
  qty: "quantity",
  price: "unit_price",
  estimated_unit_price: "unit_price",
  department: "department_code",
  dept: "department_code",
  business_justification: "justification",
  date_required: "required_date",
  needed_by: "required_date",
  request_no: "request_number",
  number: "request_number",
};

export function normalizeHeader(header: string): string {
  const key = header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return HEADER_ALIASES[key] ?? key;
}

export const csvRowSchema = z.object({
  request_number: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z0-9][A-Z0-9-]{2,29}$/.test(v), "Request number may contain only letters, digits and hyphens (3-30 chars)."),
  item_name: z.string().trim().min(2, "Item name is required (min 2 characters).").max(120, "Item name is too long."),
  description: z.string().trim().max(2000, "Description is too long."),
  quantity: quantitySchema,
  unit_price: unitPriceSchema,
  department_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, "Department code is required (e.g. OPS)."),
  justification: z.string().trim().min(10, "Justification is required (min 10 characters).").max(2000),
  required_date: requiredDateSchema,
  status: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => (v === "" ? "draft" : v.replace(/\s+/g, "_")))
    .refine((v) => v === "draft" || v === "pending_approval", "Status must be draft or pending_approval."),
});

export type CsvRow = z.infer<typeof csvRowSchema>;

export type RowVerdict = "valid" | "invalid" | "duplicate";

export interface ParsedRow {
  row: number; // 1-based data row number (excluding header)
  raw: Record<string, string>;
  data: CsvRow | null;
  status: RowVerdict;
  messages: string[];
}

export interface CsvParseResult {
  headers: string[];
  missingColumns: string[];
  unknownColumns: string[];
  rows: ParsedRow[];
  fileErrors: string[];
}

/** Parse + validate CSV text. Pure function: safe to run in browser or server. */
export function parseRequestCsv(text: string): CsvParseResult {
  const fileErrors: string[] = [];
  if (new TextEncoder().encode(text).length > CSV_MAX_BYTES) {
    return { headers: [], missingColumns: [], unknownColumns: [], rows: [], fileErrors: ["File is larger than 1 MB."] };
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });

  for (const err of parsed.errors.slice(0, 5)) {
    fileErrors.push(`CSV format error${err.row !== undefined ? ` on row ${err.row + 1}` : ""}: ${err.message}`);
  }

  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  const missingColumns = CSV_REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  const known = new Set<string>([...CSV_REQUIRED_COLUMNS, ...CSV_OPTIONAL_COLUMNS]);
  const unknownColumns = headers.filter((h) => !known.has(h));

  if (missingColumns.length > 0) {
    fileErrors.push(`Missing required column(s): ${missingColumns.join(", ")}.`);
  }
  if (parsed.data.length === 0) {
    fileErrors.push("The file contains no data rows.");
  }
  if (parsed.data.length > CSV_MAX_ROWS) {
    fileErrors.push(`A single import is limited to ${CSV_MAX_ROWS} rows (found ${parsed.data.length}).`);
  }

  if (missingColumns.length > 0 || parsed.data.length > CSV_MAX_ROWS) {
    return { headers, missingColumns, unknownColumns, rows: [], fileErrors };
  }

  const rows = markDuplicates(
    parsed.data.map((raw, i) => {
      const input = Object.fromEntries(
        [...CSV_REQUIRED_COLUMNS, ...CSV_OPTIONAL_COLUMNS].map((c) => [c, String(raw[c] ?? "")]),
      );
      const result = csvRowSchema.safeParse(input);
      if (!result.success) {
        return {
          row: i + 1,
          raw: input,
          data: null,
          status: "invalid" as const,
          messages: result.error.issues.map((iss) => `${String(iss.path[0] ?? "row")}: ${iss.message}`),
        };
      }
      const total = lineTotalCents(Number(result.data.quantity), parseMoneyToCents(result.data.unit_price));
      if (total > 9_999_999_999_999n) {
        return { row: i + 1, raw: input, data: null, status: "invalid" as const, messages: ["Request total exceeds the maximum allowed amount."] };
      }
      return { row: i + 1, raw: input, data: result.data, status: "valid" as const, messages: [] };
    }),
  );

  return { headers, missingColumns, unknownColumns, rows, fileErrors };
}

export function rowFingerprint(row: CsvRow): string {
  return [
    row.item_name.trim().toLowerCase(),
    Number(row.quantity),
    parseMoneyToCents(row.unit_price).toString(),
    row.department_code.toUpperCase(),
    row.required_date,
  ].join("|");
}

/** Mark in-file duplicates (same request number, or identical content). */
export function markDuplicates(rows: ParsedRow[]): ParsedRow[] {
  const numbers = new Map<string, number>();
  const fingerprints = new Map<string, number>();
  return rows.map((r) => {
    if (r.status !== "valid" || !r.data) return r;
    const num = r.data.request_number;
    if (num && numbers.has(num)) {
      return { ...r, status: "duplicate", messages: [`Request number ${num} already appears on row ${numbers.get(num)}.`] };
    }
    const fp = rowFingerprint(r.data);
    if (fingerprints.has(fp)) {
      return { ...r, status: "duplicate", messages: [`Identical to row ${fingerprints.get(fp)} (item, quantity, price, department, date).`] };
    }
    if (num) numbers.set(num, r.row);
    fingerprints.set(fp, r.row);
    return r;
  });
}

export function summarize(rows: Pick<ParsedRow, "status">[]) {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
  };
}

// ---------------------------------------------------------------------------
// CSV writing
// ---------------------------------------------------------------------------

/**
 * Escape a value for CSV output. Values that a spreadsheet could interpret as
 * a formula (=, +, -, @, tab, CR) are prefixed with an apostrophe to prevent
 * CSV/formula injection.
 */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T; header: string }[]): string {
  const head = columns.map((c) => escapeCsvValue(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}

/** Template with dates relative to today so the sample always validates. */
export function buildTemplateCsv(departmentCode = "OPS", today: Date = new Date()): string {
  const date = (days: number) => {
    const d = new Date(today.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return toCsv(
    [
      {
        request_number: "",
        item_name: "Thermal label printer",
        quantity: "2",
        unit_price: "3250000.00",
        department_code: departmentCode,
        justification: "Replace two failing printers at the dispatch desk.",
        required_date: date(14),
        description: "Direct thermal, 4-inch, USB + Ethernet",
        status: "draft",
      },
      {
        request_number: "",
        item_name: "Safety helmets",
        quantity: "25",
        unit_price: "185000",
        department_code: departmentCode,
        justification: "Annual PPE replacement required by the safety audit.",
        required_date: date(21),
        description: "EN 397 certified, white",
        status: "pending_approval",
      },
    ],
    [...CSV_ALL_COLUMNS].map((c) => ({ key: c, header: c })),
  );
}
