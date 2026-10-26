"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileEdit,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "./status-badge";
import { RequestFormDialog } from "./request-form-dialog";
import { RequestDetailSheet } from "./request-detail-sheet";
import { CsvImportDialog } from "./csv-import-dialog";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { canEditDraft, canSubmit, STATUS_LABELS } from "@/lib/workflow";
import { submitPurchaseRequestAction } from "@/app/actions";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/types";
import type { AppSessionContext, EnrichedPurchaseRequest } from "@/lib/data";

type SortField = "created_at" | "request_number" | "total_amount" | "required_date" | "item_name";

export function RequestsClient({
  context,
  requests,
  initialOpenNew = false,
}: {
  context: AppSessionContext;
  requests: EnrichedPurchaseRequest[];
  initialOpenNew?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<RequestStatus | "all">("all");
  const [departmentFilter, setDepartmentFilter] = React.useState("all");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");

  const [sortField, setSortField] = React.useState<SortField>("created_at");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(8);

  const [formOpen, setFormOpen] = React.useState(initialOpenNew);
  const [editingDraft, setEditingDraft] = React.useState<EnrichedPurchaseRequest | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [submittingId, setSubmittingId] = React.useState<string | null>(null);

  const selectedRequest = React.useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  // Status tab counts (before status filter, after search/dept/date filters)
  const baseFiltered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (departmentFilter !== "all" && r.department_id !== departmentFilter) return false;
      const created = r.created_at.slice(0, 10);
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
      if (q) {
        const hay = `${r.request_number} ${r.item_name} ${r.description} ${r.requester_name} ${r.department_code} ${r.justification}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, search, departmentFilter, fromDate, toDate]);

  const statusCounts = React.useMemo(() => {
    const map: Record<string, number> = { all: baseFiltered.length };
    for (const s of REQUEST_STATUSES) map[s] = 0;
    for (const r of baseFiltered) map[r.status] = (map[r.status] ?? 0) + 1;
    return map;
  }, [baseFiltered]);

  const sorted = React.useMemo(() => {
    const list =
      statusFilter === "all"
        ? [...baseFiltered]
        : baseFiltered.filter((r) => r.status === statusFilter);

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "total_amount") {
        const ca = parseMoneyToCents(a.total_amount);
        const cb = parseMoneyToCents(b.total_amount);
        cmp = ca < cb ? -1 : ca > cb ? 1 : 0;
      } else if (sortField === "created_at") {
        cmp = a.created_at.localeCompare(b.created_at);
      } else if (sortField === "required_date") {
        cmp = a.required_date.localeCompare(b.required_date);
      } else if (sortField === "request_number") {
        cmp = a.request_number.localeCompare(b.request_number);
      } else {
        cmp = a.item_name.localeCompare(b.item_name);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [baseFiltered, statusFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  async function handleQuickSubmit(req: EnrichedPurchaseRequest, e: React.MouseEvent) {
    e.stopPropagation();
    setSubmittingId(req.id);
    try {
      const res = await submitPurchaseRequestAction(req.id);
      if (res.ok) {
        toast.success(res.message ?? `Submitted ${req.request_number}`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } finally {
      setSubmittingId(null);
    }
  }

  const exportUrl = React.useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (departmentFilter !== "all") params.set("departmentId", departmentFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (search.trim()) params.set("q", search.trim());
    const qs = params.toString();
    return `/api/requests/export${qs ? `?${qs}` : ""}`;
  }, [statusFilter, departmentFilter, fromDate, toDate, search]);

  const currency = context.settings.currency;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Purchase Requests Register
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Create, validate, submit, and audit internal purchase requests with server-calculated decimal totals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
            className="gap-1.5"
          >
            <FileUp className="size-3.5 text-teal-600" />
            Batch CSV Import
          </Button>
          <a
            href={exportUrl}
            download
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[0.8rem] font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="size-3.5 text-teal-600" />
            Export Filtered CSV ({sorted.length})
          </a>
          <Button
            size="sm"
            onClick={() => {
              setEditingDraft(null);
              setFormOpen(true);
            }}
            className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
          >
            <Plus className="size-3.5" />
            New Purchase Request
          </Button>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-3">
        {(["all", ...REQUEST_STATUSES] as const).map((st) => {
          const active = statusFilter === st;
          const label = st === "all" ? "All Requests" : STATUS_LABELS[st];
          return (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              <span>{label}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 font-mono text-[10px] font-semibold ${
                  active ? "bg-teal-400 text-slate-950" : "bg-slate-100 text-slate-600"
                }`}
              >
                {statusCounts[st] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search, Department & Date Filters */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="md:col-span-5 relative">
          <Search className="size-4 text-slate-400 absolute left-2.5 top-2" />
          <Input
            placeholder="Search request #, item, requester, or justification..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>

        <div className="md:col-span-3">
          <select
            aria-label="Filter by department"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800 outline-none focus:border-teal-600"
          >
            <option value="all">All Departments</option>
            {context.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <Input
            type="date"
            aria-label="Created from date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 font-mono text-xs"
          />
        </div>

        <div className="md:col-span-2 flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="Created to date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 font-mono text-xs"
          />
          {(search || statusFilter !== "all" || departmentFilter !== "all" || fromDate || toDate) && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Reset filters"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setDepartmentFilter("all");
                setFromDate("");
                setToDate("");
              }}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Compact Enterprise Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 mb-3">
              <FileSpreadsheet className="size-5" />
            </div>
            <p className="text-sm font-semibold text-slate-900">
              No purchase requests found
            </p>
            <p className="text-xs text-slate-500 max-w-md mt-1">
              No records match your current search or filter settings, or you have not created any requests yet.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setEditingDraft(null);
                  setFormOpen(true);
                }}
                className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
              >
                <Plus className="size-3.5" />
                Create Purchase Request
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/90 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort("request_number")}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        Request # <ArrowUpDown className="size-3" />
                      </button>
                    </th>
                    <th className="px-4 py-3 font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleSort("item_name")}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        Item & Justification <ArrowUpDown className="size-3" />
                      </button>
                    </th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Dept</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Requester</th>
                    <th className="px-4 py-3 font-semibold text-right whitespace-nowrap">
                      Qty × Unit
                    </th>
                    <th className="px-4 py-3 font-semibold text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort("total_amount")}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        Total ({currency}) <ArrowUpDown className="size-3" />
                      </button>
                    </th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort("created_at")}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        Created / Needed <ArrowUpDown className="size-3" />
                      </button>
                    </th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                    <th className="px-4 py-3 font-semibold text-right whitespace-nowrap">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedRows.map((r) => {
                    const editable = canEditDraft(context.profile, r);
                    const submittable = canSubmit(context.profile, r);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedId(r.id)}
                        className="cursor-pointer hover:bg-slate-50/90 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono font-semibold text-teal-700 whitespace-nowrap">
                          {r.request_number}
                        </td>
                        <td className="px-4 py-3 max-w-[260px]">
                          <p className="font-semibold text-slate-900 truncate">
                            {r.item_name}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {r.justification}
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                            {r.department_code}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-medium text-slate-800">{r.requester_name}</p>
                          <p className="text-[11px] text-slate-400">{r.requester_email}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-right text-slate-600 tabular-nums whitespace-nowrap">
                          {r.quantity} × {formatMoney(r.unit_price, currency, true)}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-right text-slate-900 tabular-nums whitespace-nowrap">
                          {formatMoney(r.total_amount, currency)}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                          <div>{r.created_at.slice(0, 10)}</div>
                          <div className="text-slate-400">Due {r.required_date}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusBadge status={r.status} />
                        </td>
                        <td
                          className="px-4 py-3 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-1">
                            {editable && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                title="Edit draft"
                                onClick={() => {
                                  setEditingDraft(r);
                                  setFormOpen(true);
                                }}
                              >
                                <FileEdit className="size-3.5 text-slate-600" />
                              </Button>
                            )}
                            {submittable && (
                              <Button
                                variant="outline"
                                size="xs"
                                disabled={submittingId === r.id}
                                onClick={(e) => handleQuickSubmit(r, e)}
                                className="gap-1 text-[11px] text-teal-700 border-teal-200 hover:bg-teal-50"
                              >
                                {submittingId === r.id ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Send className="size-3" />
                                )}
                                Submit
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              title="Inspect request & audit history"
                              onClick={() => setSelectedId(r.id)}
                            >
                              <Eye className="size-3.5 text-slate-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span>
                  Showing{" "}
                  <strong className="font-mono text-slate-900">
                    {(safePage - 1) * pageSize + 1}
                  </strong>
                  –
                  <strong className="font-mono text-slate-900">
                    {Math.min(safePage * pageSize, sorted.length)}
                  </strong>{" "}
                  of <strong className="font-mono text-slate-900">{sorted.length}</strong>
                </span>
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs"
                >
                  <option value={8}>8 / page</option>
                  <option value={15}>15 / page</option>
                  <option value={25}>25 / page</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="gap-1"
                >
                  <ChevronLeft className="size-3.5" />
                  Prev
                </Button>
                <span className="font-mono px-2">
                  Page {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="gap-1"
                >
                  Next
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Dialogs & Drawer */}
      <RequestFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        profile={context.profile}
        departments={context.departments}
        currency={currency}
        editingDraft={editingDraft}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultDepartmentCode={context.department?.code ?? "OPS"}
      />

      <RequestDetailSheet
        request={selectedRequest}
        open={Boolean(selectedRequest)}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null);
        }}
        profile={context.profile}
        currency={currency}
        allowSelfApproval={context.settings.allow_self_approval}
        onEditDraft={(draft) => {
          setEditingDraft(draft);
          setFormOpen(true);
        }}
      />
    </div>
  );
}
