"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  buildTemplateCsv,
  CSV_REQUIRED_COLUMNS,
  parseRequestCsv,
  toCsv,
  type CsvParseResult,
} from "@/lib/csv";
import {
  importPurchaseRequestsAction,
} from "@/app/actions";
import type { DbImportResult, ImportRowInput } from "@/lib/data";

interface CombinedRow {
  row: number;
  request_number: string;
  item_name: string;
  quantity: string;
  unit_price: string;
  department_code: string;
  required_date: string;
  status: string;
  verdict: "valid" | "duplicate" | "invalid";
  messages: string[];
}

export function CsvImportDialog({
  open,
  onOpenChange,
  defaultDepartmentCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDepartmentCode: string;
}) {
  const router = useRouter();
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [clientParsed, setClientParsed] = React.useState<CsvParseResult | null>(null);
  const [serverResult, setServerResult] = React.useState<DbImportResult | null>(null);
  const [committedResult, setCommittedResult] = React.useState<DbImportResult | null>(null);
  const [filterVerdict, setFilterVerdict] = React.useState<"all" | "valid" | "duplicate" | "invalid">("all");
  const [isValidating, setIsValidating] = React.useState(false);
  const [isCommitting, setIsCommitting] = React.useState(false);

  function resetState() {
    setFileName(null);
    setClientParsed(null);
    setServerResult(null);
    setCommittedResult(null);
    setFilterVerdict("all");
  }

  function handleDialogChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  }

  async function processCsvText(text: string, name: string) {
    setFileName(name);
    setCommittedResult(null);
    setServerResult(null);

    const parsed = parseRequestCsv(text);
    setClientParsed(parsed);

    if (parsed.fileErrors.length > 0 || parsed.rows.length === 0) {
      return;
    }

    // Run server-side dry-run validation against PostgreSQL to check DB-level duplicates & department permissions
    setIsValidating(true);
    try {
      const payload: ImportRowInput[] = parsed.rows.map((r) => ({
        request_number: r.raw.request_number || null,
        item_name: r.raw.item_name ?? "",
        description: r.raw.description ?? "",
        quantity: r.raw.quantity ?? "",
        unit_price: r.raw.unit_price ?? "",
        department_code: r.raw.department_code ?? "",
        justification: r.raw.justification ?? "",
        required_date: r.raw.required_date ?? "",
        status: r.raw.status || "draft",
      }));
      const res = await importPurchaseRequestsAction({ rows: payload, dryRun: true });
      if (res.ok) {
        setServerResult(res.data);
      } else {
        toast.error(res.error);
      }
    } finally {
      setIsValidating(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await processCsvText(text, file.name);
    e.target.value = "";
  }

  async function handleLoadSampleWithEdgeCases() {
    const template = buildTemplateCsv(defaultDepartmentCode);
    const lines = template.trim().split(/\r?\n/);
    // Add one duplicate row and one invalid row to demonstrate validation & error report
    const duplicateLine = lines[1];
    const invalidLine = `,Short,-5,not_a_price,${defaultDepartmentCode},too short,2020-01-01,Bad spec,approved`;
    const demoCsv = [...lines, duplicateLine, invalidLine].join("\r\n") + "\r\n";
    await processCsvText(demoCsv, `demo-batch-${defaultDepartmentCode.toLowerCase()}.csv`);
  }

  const combinedRows: CombinedRow[] = React.useMemo(() => {
    if (!clientParsed) return [];
    const srvRows = serverResult?.rows ?? [];
    return clientParsed.rows.map((r, idx) => {
      const srv = srvRows[idx];
      const verdict = srv ? srv.status : r.status;
      const messages = srv && srv.messages.length > 0 ? srv.messages : r.messages;
      return {
        row: r.row,
        request_number: r.raw.request_number || "(auto)",
        item_name: r.raw.item_name || "—",
        quantity: r.raw.quantity || "—",
        unit_price: r.raw.unit_price || "—",
        department_code: r.raw.department_code || "—",
        required_date: r.raw.required_date || "—",
        status: r.raw.status || "draft",
        verdict,
        messages,
      };
    });
  }, [clientParsed, serverResult]);

  const counts = React.useMemo(() => {
    return {
      total: combinedRows.length,
      valid: combinedRows.filter((r) => r.verdict === "valid").length,
      duplicate: combinedRows.filter((r) => r.verdict === "duplicate").length,
      invalid: combinedRows.filter((r) => r.verdict === "invalid").length,
    };
  }, [combinedRows]);

  const visibleRows = React.useMemo(() => {
    if (filterVerdict === "all") return combinedRows;
    return combinedRows.filter((r) => r.verdict === filterVerdict);
  }, [combinedRows, filterVerdict]);

  async function handleCommitImport() {
    if (!clientParsed || counts.valid === 0) return;
    setIsCommitting(true);
    try {
      const payload: ImportRowInput[] = clientParsed.rows.map((r) => ({
        request_number: r.raw.request_number || null,
        item_name: r.raw.item_name ?? "",
        description: r.raw.description ?? "",
        quantity: r.raw.quantity ?? "",
        unit_price: r.raw.unit_price ?? "",
        department_code: r.raw.department_code ?? "",
        justification: r.raw.justification ?? "",
        required_date: r.raw.required_date ?? "",
        status: r.raw.status || "draft",
      }));
      const res = await importPurchaseRequestsAction({ rows: payload, dryRun: false });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setCommittedResult(res.data);
      setServerResult(res.data);
      toast.success(res.message ?? `Imported ${res.data.inserted} purchase request(s)`);
      router.refresh();
    } finally {
      setIsCommitting(false);
    }
  }

  function handleDownloadErrorReport() {
    const problemRows = combinedRows.filter((r) => r.verdict !== "valid");
    if (problemRows.length === 0) return;
    const csv = toCsv(
      problemRows.map((r) => ({
        row_number: r.row,
        verdict: r.verdict,
        item_name: r.item_name,
        department_code: r.department_code,
        quantity: r.quantity,
        unit_price: r.unit_price,
        required_date: r.required_date,
        error_details: r.messages.join("; "),
      })),
      [
        { key: "row_number", header: "row_number" },
        { key: "verdict", header: "verdict" },
        { key: "item_name", header: "item_name" },
        { key: "department_code", header: "department_code" },
        { key: "quantity", header: "quantity" },
        { key: "unit_price", header: "unit_price" },
        { key: "required_date", header: "required_date" },
        { key: "error_details", header: "error_details" },
      ],
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flowtrack-import-error-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <FileSpreadsheet className="size-4 text-teal-600" />
            Batch CSV Import & Validation Workbench
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Upload a CSV spreadsheet to validate columns, required fields, and duplicates before writing to PostgreSQL inside a database transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Upload & Template Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-800">
                Required columns: <span className="font-mono text-[11px] text-teal-800">{CSV_REQUIRED_COLUMNS.join(", ")}</span>
              </p>
              <p className="text-[11px] text-slate-500">
                Optional columns: <span className="font-mono">request_number, description, status</span> (draft or pending_approval).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href={`/api/requests/export?template=1&dept=${encodeURIComponent(defaultDepartmentCode)}`}
                download
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="size-3.5 text-teal-600" />
                Template CSV
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadSampleWithEdgeCases}
                className="gap-1.5 text-xs"
              >
                <Sparkles className="size-3.5 text-teal-600" />
                Load Sample Batch
              </Button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-xs font-medium text-white hover:bg-teal-700">
                <FileUp className="size-3.5" />
                Select CSV File
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileSelect}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {/* File-level / Column errors */}
          {clientParsed && clientParsed.fileErrors.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <XCircle className="size-4 text-rose-600" />
                Column & File Validation Errors ({fileName})
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                {clientParsed.fileErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Committed Import Result Banner */}
          {committedResult && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950 flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Import Complete — {committedResult.inserted} Purchase Request(s) Written
                  </p>
                  <p className="text-[11px] text-emerald-800">
                    {committedResult.duplicates} duplicate(s) and {committedResult.invalid} invalid row(s) were safely skipped.
                  </p>
                </div>
              </div>
              {(committedResult.duplicates > 0 || committedResult.invalid > 0) && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={handleDownloadErrorReport}
                  className="shrink-0 gap-1"
                >
                  <Download className="size-3" />
                  Download Error Report
                </Button>
              )}
            </div>
          )}

          {/* Preview Summary & Table */}
          {combinedRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFilterVerdict("all")}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      filterVerdict === "all"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    All Rows ({counts.total})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterVerdict("valid")}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      filterVerdict === "valid"
                        ? "bg-emerald-600 text-white"
                        : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    }`}
                  >
                    Valid ({counts.valid})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterVerdict("duplicate")}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      filterVerdict === "duplicate"
                        ? "bg-amber-600 text-white"
                        : "bg-amber-50 text-amber-800 hover:bg-amber-100"
                    }`}
                  >
                    Duplicates ({counts.duplicate})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterVerdict("invalid")}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      filterVerdict === "invalid"
                        ? "bg-rose-600 text-white"
                        : "bg-rose-50 text-rose-800 hover:bg-rose-100"
                    }`}
                  >
                    Invalid ({counts.invalid})
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {isValidating && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Loader2 className="size-3.5 animate-spin" />
                      Checking DB duplicates...
                    </span>
                  )}
                  {(counts.duplicate > 0 || counts.invalid > 0) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={handleDownloadErrorReport}
                      className="gap-1 text-xs"
                    >
                      <Download className="size-3" />
                      Error Report CSV ({counts.duplicate + counts.invalid})
                    </Button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-72">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-semibold">#</th>
                      <th className="px-3 py-2 font-semibold">Validation</th>
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 font-semibold">Dept</th>
                      <th className="px-3 py-2 font-semibold text-right">Qty</th>
                      <th className="px-3 py-2 font-semibold text-right">Unit Price</th>
                      <th className="px-3 py-2 font-semibold">Required</th>
                      <th className="px-3 py-2 font-semibold">Details / Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {visibleRows.map((r) => (
                      <tr key={r.row} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2 font-mono text-slate-400">{r.row}</td>
                        <td className="px-3 py-2">
                          {r.verdict === "valid" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                              <CheckCircle2 className="size-3" /> Ready
                            </span>
                          ) : r.verdict === "duplicate" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                              <AlertTriangle className="size-3" /> Duplicate
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-medium text-rose-800">
                              <XCircle className="size-3" /> Invalid
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900 max-w-[180px] truncate">
                          {r.item_name}
                        </td>
                        <td className="px-3 py-2 font-mono">{r.department_code}</td>
                        <td className="px-3 py-2 font-mono text-right">{r.quantity}</td>
                        <td className="px-3 py-2 font-mono text-right">{r.unit_price}</td>
                        <td className="px-3 py-2 font-mono">{r.required_date}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[240px]">
                          {r.messages.length === 0 ? (
                            <span className="text-emerald-700">Passes schema & duplicate checks</span>
                          ) : (
                            <span className="text-rose-700">{r.messages.join(" · ")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {counts.valid > 0 && !committedResult && (
            <Button
              type="button"
              disabled={isCommitting || isValidating}
              onClick={handleCommitImport}
              className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
            >
              {isCommitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Import {counts.valid} Valid Request{counts.valid === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
