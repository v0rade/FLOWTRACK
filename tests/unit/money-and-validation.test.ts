import { describe, expect, it } from "vitest";
import {
  centsToDecimalString,
  formatCents,
  isValidMoney,
  lineTotalCents,
  parseMoneyToCents,
  sumCents,
  tryParseMoneyToCents,
} from "@/lib/money";
import {
  isoDate,
  rejectSchema,
  requestFormSchema,
  settingsSchema,
} from "@/lib/validation";

describe("decimal-safe monetary calculations", () => {
  it("avoids IEEE-754 floating point drift on classic 0.1 + 0.2 and 3 × 0.10 cases", () => {
    const a = parseMoneyToCents("0.10");
    const b = parseMoneyToCents("0.20");
    expect(centsToDecimalString(sumCents([a, b]))).toBe("0.30");

    const line = lineTotalCents(3, parseMoneyToCents("0.10"));
    expect(centsToDecimalString(line)).toBe("0.30");
  });

  it("handles large enterprise IDR amounts accurately", () => {
    const unit = parseMoneyToCents("18750000.75");
    const total = lineTotalCents(12, unit);
    expect(centsToDecimalString(total)).toBe("225000009.00");
    expect(formatCents(total, "IDR")).toContain("225,000,009");
  });

  it("rejects malformed monetary strings", () => {
    expect(isValidMoney("1250.555")).toBe(false);
    expect(isValidMoney("-10")).toBe(false);
    expect(isValidMoney("abc")).toBe(false);
    expect(tryParseMoneyToCents("not-a-number")).toBeNull();
    expect(() => parseMoneyToCents("12.345")).toThrow(/Invalid monetary amount/);
  });
});

describe("purchase request & workflow Zod schemas", () => {
  const validPayload = {
    item_name: "Dell Latitude 5450 Laptop",
    description: "16GB RAM, 512GB NVMe SSD, 3yr ProSupport",
    quantity: "4",
    unit_price: "16500000.00",
    department_id: "00000000-0000-4000-8000-0000000000d1",
    justification: "New hires joining the Operations engineering squad next month.",
    required_date: isoDate(14),
  };

  it("accepts a valid purchase request payload", () => {
    const parsed = requestFormSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
  });

  it("rejects missing or out-of-range fields", () => {
    expect(requestFormSchema.safeParse({ ...validPayload, item_name: "A" }).success).toBe(false);
    expect(requestFormSchema.safeParse({ ...validPayload, quantity: "0" }).success).toBe(false);
    expect(requestFormSchema.safeParse({ ...validPayload, unit_price: "-100" }).success).toBe(false);
    expect(requestFormSchema.safeParse({ ...validPayload, justification: "Too short" }).success).toBe(false);
    expect(requestFormSchema.safeParse({ ...validPayload, required_date: "2020-01-01" }).success).toBe(false);
  });

  it("rejects requests whose computed total exceeds the maximum", () => {
    const res = requestFormSchema.safeParse({
      ...validPayload,
      quantity: "100000",
      unit_price: "5000000000.00",
    });
    expect(res.success).toBe(false);
  });

  it("enforces a non-empty reason when rejecting a request", () => {
    const id = "00000000-0000-4000-8000-000000000099";
    expect(rejectSchema.safeParse({ id, reason: "   " }).success).toBe(false);
    expect(rejectSchema.safeParse({ id, reason: "no" }).success).toBe(false);
    expect(
      rejectSchema.safeParse({ id, reason: "Exceeds Q4 department cap; defer to Q1." }).success,
    ).toBe(true);
  });

  it("validates application settings & ROI assumptions", () => {
    expect(
      settingsSchema.safeParse({
        organization_name: "Nusantara Supplies Co. (Demo)",
        currency: "IDR",
        allow_self_approval: false,
        manual_minutes_per_request: 95,
        digital_minutes_per_request: 20,
        manual_cycle_days: 5,
        hourly_staff_cost: "85000.00",
      }).success,
    ).toBe(true);
  });
});
