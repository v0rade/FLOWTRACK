import { describe, expect, it } from "vitest";
import {
  buildTemplateCsv,
  escapeCsvValue,
  parseRequestCsv,
  summarize,
  toCsv,
} from "@/lib/csv";
import { isoDate } from "@/lib/validation";

describe("CSV import parser, validator, and duplicate detector", () => {
  it("parses and validates the generated template CSV cleanly", () => {
    const csv = buildTemplateCsv("OPS");
    const parsed = parseRequestCsv(csv);
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.missingColumns).toEqual([]);
    const summary = summarize(parsed.rows);
    expect(summary).toEqual({ total: 2, valid: 2, invalid: 0, duplicates: 0 });
  });

  it("reports missing required columns", () => {
    const csv = "item_name,quantity\nLaptop,2\n";
    const parsed = parseRequestCsv(csv);
    expect(parsed.missingColumns).toEqual(
      expect.arrayContaining(["unit_price", "department_code", "justification", "required_date"]),
    );
    expect(parsed.fileErrors[0]).toMatch(/Missing required column/);
  });

  it("detects duplicate request numbers and duplicate row fingerprints inside a CSV", () => {
    const reqDate = isoDate(15);
    const csv = [
      "request_number,item_name,quantity,unit_price,department_code,justification,required_date,status",
      `PR-2026-90001,Industrial Barcode Scanner,3,2400000.00,OPS,Required for receiving dock lane B.,${reqDate},draft`,
      `PR-2026-90001,Different Item Same Number,1,500000.00,OPS,Required for receiving dock lane B.,${reqDate},draft`,
      `,Thermal Ribbon Box,10,175000.00,OPS,Monthly consumable replenishment for warehouse.,${reqDate},pending_approval`,
      `,thermal ribbon box,10,175000,OPS,Second accidental entry in same spreadsheet.,${reqDate},draft`,
      `,Invalid Row,-2,abc,OPS,bad,2020-01-01,approved`,
    ].join("\n");

    const parsed = parseRequestCsv(csv);
    expect(parsed.rows.map((r) => r.status)).toEqual([
      "valid",
      "duplicate",
      "valid",
      "duplicate",
      "invalid",
    ]);
    expect(summarize(parsed.rows)).toEqual({
      total: 5,
      valid: 2,
      duplicates: 2,
      invalid: 1,
    });
    expect(parsed.rows[1].messages[0]).toMatch(/already appears on row 1/);
    expect(parsed.rows[3].messages[0]).toMatch(/Identical to row 3/);
    expect(parsed.rows[4].messages.length).toBeGreaterThanOrEqual(3);
  });

  it("neutralizes spreadsheet formula injection in CSV export", () => {
    expect(escapeCsvValue("=CMD|' /C calc'!A0")).toBe("'=CMD|' /C calc'!A0");
    expect(escapeCsvValue("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
    expect(escapeCsvValue("@IMPORTXML()")).toBe("'@IMPORTXML()");
    // Negative numbers are kept numeric
    expect(escapeCsvValue("-125.50")).toBe("-125.50");

    const out = toCsv(
      [{ item: '=HYPERLINK("http://evil")', amount: "1500.00" }],
      [
        { key: "item", header: "Item" },
        { key: "amount", header: "Amount" },
      ],
    );
    expect(out).toContain(`"'=HYPERLINK(""http://evil"")",1500.00`);
  });
});
