import { NextRequest, NextResponse } from "next/server";
import { buildTemplateCsv, toCsv } from "@/lib/csv";
import { getAppContext, listVisibleRequests } from "@/lib/data";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ctx = await getAppContext();

  if (!ctx) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (searchParams.get("template") === "1") {
    const deptCode = searchParams.get("dept") || ctx.department?.code || "OPS";
    const csv = buildTemplateCsv(deptCode);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="flowtrack-import-template-${deptCode.toLowerCase()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const all = await listVisibleRequests();
  const statusFilter = searchParams.get("status")?.trim();
  const deptFilter = searchParams.get("departmentId")?.trim();
  const fromFilter = searchParams.get("from")?.trim();
  const toFilter = searchParams.get("to")?.trim();
  const qFilter = searchParams.get("q")?.trim().toLowerCase();

  const filtered = all.filter((r) => {
    if (statusFilter && statusFilter !== "all" && r.status !== statusFilter) return false;
    if (deptFilter && deptFilter !== "all" && r.department_id !== deptFilter) return false;
    const createdDate = r.created_at.slice(0, 10);
    if (fromFilter && createdDate < fromFilter) return false;
    if (toFilter && createdDate > toFilter) return false;
    if (qFilter) {
      const hay = `${r.request_number} ${r.item_name} ${r.description} ${r.requester_name} ${r.department_code} ${r.justification}`.toLowerCase();
      if (!hay.includes(qFilter)) return false;
    }
    return true;
  });

  const csvRows = filtered.map((r) => ({
    request_number: r.request_number,
    status: r.status,
    item_name: r.item_name,
    description: r.description,
    quantity: r.quantity,
    unit_price: r.unit_price,
    total_amount: r.total_amount,
    currency: ctx.settings.currency,
    department_code: r.department_code,
    department_name: r.department_name,
    requester_name: r.requester_name,
    requester_email: r.requester_email,
    justification: r.justification,
    created_date: r.created_at.slice(0, 10),
    required_date: r.required_date,
    submitted_at: r.submitted_at ?? "",
    decided_at: r.decided_at ?? "",
    decided_by: r.decided_by_name ?? "",
    decision_comment: r.decision_comment ?? "",
    source: r.source,
  }));

  const csv = toCsv(csvRows, [
    { key: "request_number", header: "request_number" },
    { key: "status", header: "status" },
    { key: "item_name", header: "item_name" },
    { key: "description", header: "description" },
    { key: "quantity", header: "quantity" },
    { key: "unit_price", header: "unit_price" },
    { key: "total_amount", header: "total_amount" },
    { key: "currency", header: "currency" },
    { key: "department_code", header: "department_code" },
    { key: "department_name", header: "department_name" },
    { key: "requester_name", header: "requester_name" },
    { key: "requester_email", header: "requester_email" },
    { key: "justification", header: "justification" },
    { key: "created_date", header: "created_date" },
    { key: "required_date", header: "required_date" },
    { key: "submitted_at", header: "submitted_at" },
    { key: "decided_at", header: "decided_at" },
    { key: "decided_by", header: "decided_by" },
    { key: "decision_comment", header: "decision_comment" },
    { key: "source", header: "source" },
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="flowtrack-purchase-requests-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
