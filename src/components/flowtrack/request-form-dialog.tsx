"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Calculator, Loader2, Plus, Send, Save } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  isoDate,
  requestFormSchema,
  type RequestFormValues,
} from "@/lib/validation";
import {
  formatCents,
  lineTotalCents,
  tryParseMoneyToCents,
} from "@/lib/money";
import {
  createPurchaseRequestAction,
  updateDraftRequestAction,
} from "@/app/actions";
import type { Department, Profile } from "@/lib/types";
import type { EnrichedPurchaseRequest } from "@/lib/data";

export function RequestFormDialog({
  open,
  onOpenChange,
  profile,
  departments,
  currency,
  editingDraft,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile;
  departments: Department[];
  currency: string;
  editingDraft?: EnrichedPurchaseRequest | null;
  onSuccess?: (id?: string) => void;
}) {
  const router = useRouter();
  const [submitMode, setSubmitMode] = React.useState<"draft" | "submit">("submit");
  const [serverError, setServerError] = React.useState<string | null>(null);

  const activeDepts = departments.filter((d) => d.is_active);
  const defaultDeptId =
    editingDraft?.department_id ??
    profile.department_id ??
    activeDepts[0]?.id ??
    "";

  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: {
      item_name: editingDraft?.item_name ?? "",
      description: editingDraft?.description ?? "",
      quantity: editingDraft ? String(editingDraft.quantity) : "1",
      unit_price: editingDraft ? editingDraft.unit_price : "",
      department_id: defaultDeptId,
      justification: editingDraft?.justification ?? "",
      required_date: editingDraft?.required_date ?? isoDate(14),
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        item_name: editingDraft?.item_name ?? "",
        description: editingDraft?.description ?? "",
        quantity: editingDraft ? String(editingDraft.quantity) : "1",
        unit_price: editingDraft ? editingDraft.unit_price : "",
        department_id:
          editingDraft?.department_id ??
          profile.department_id ??
          activeDepts[0]?.id ??
          "",
        justification: editingDraft?.justification ?? "",
        required_date: editingDraft?.required_date ?? isoDate(14),
      });
    }
  }, [open, editingDraft, profile.department_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const watchedQty = useWatch({ control: form.control, name: "quantity" });
  const watchedPrice = useWatch({ control: form.control, name: "unit_price" });

  const parsedQty = /^\d+$/.test(watchedQty?.trim() ?? "") ? Number(watchedQty.trim()) : 0;
  const parsedUnitCents = tryParseMoneyToCents(watchedPrice);
  const previewTotalCents =
    parsedQty > 0 && parsedUnitCents !== null
      ? lineTotalCents(parsedQty, parsedUnitCents)
      : BigInt(0);

  const isSubmitting = form.formState.isSubmitting;
  const isAdmin = profile.role === "admin";

  async function onSubmit(values: RequestFormValues) {
    setServerError(null);
    if (editingDraft) {
      const res = await updateDraftRequestAction({
        ...values,
        id: editingDraft.id,
        version: editingDraft.version,
      });
      if (!res.ok) {
        setServerError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Draft updated");
      onOpenChange(false);
      router.refresh();
      onSuccess?.(editingDraft.id);
      return;
    }

    const res = await createPurchaseRequestAction({
      ...values,
      submit: submitMode === "submit",
    });
    if (!res.ok) {
      setServerError(res.error);
      toast.error(res.error);
      return;
    }
    toast.success(res.message ?? "Purchase request created");
    onOpenChange(false);
    router.refresh();
    onSuccess?.(res.data.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Plus className="size-4 text-teal-600" />
            {editingDraft
              ? `Edit Draft ${editingDraft.request_number}`
              : "New Purchase Request"}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {editingDraft
              ? "Update item specifications, quantity, or justification before submitting for manager approval."
              : "Digitize an internal purchase request. Totals are calculated on the PostgreSQL server using exact decimal arithmetic."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-1" noValidate>
          {serverError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {serverError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="pr-item-name" className="text-xs font-medium text-slate-700">
                Item Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="pr-item-name"
                placeholder="e.g., Zebra ZD421 Industrial Thermal Printer"
                {...form.register("item_name")}
              />
              {form.formState.errors.item_name && (
                <p className="text-xs text-rose-600">
                  {form.formState.errors.item_name.message}
                </p>
              )}
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="pr-description" className="text-xs font-medium text-slate-700">
                Technical Specifications / Description
              </Label>
              <Input
                id="pr-description"
                placeholder="Model number, configuration, vendor catalog reference..."
                {...form.register("description")}
              />
              {form.formState.errors.description && (
                <p className="text-xs text-rose-600">
                  {form.formState.errors.description.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pr-quantity" className="text-xs font-medium text-slate-700">
                Quantity <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="pr-quantity"
                type="number"
                min={1}
                step={1}
                className="font-mono"
                {...form.register("quantity")}
              />
              {form.formState.errors.quantity && (
                <p className="text-xs text-rose-600">
                  {form.formState.errors.quantity.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pr-unit-price" className="text-xs font-medium text-slate-700">
                Estimated Unit Price ({currency}) <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="pr-unit-price"
                placeholder="e.g., 4850000.00"
                className="font-mono"
                {...form.register("unit_price")}
              />
              {form.formState.errors.unit_price && (
                <p className="text-xs text-rose-600">
                  {form.formState.errors.unit_price.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pr-department" className="text-xs font-medium text-slate-700">
                Department <span className="text-rose-500">*</span>
              </Label>
              <select
                id="pr-department"
                disabled={!isAdmin && Boolean(profile.department_id)}
                className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-slate-100 disabled:text-slate-500"
                {...form.register("department_id")}
              >
                {activeDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
              {!isAdmin && (
                <p className="text-[11px] text-slate-400">
                  Scoped to your assigned department by server policy.
                </p>
              )}
              {form.formState.errors.department_id && (
                <p className="text-xs text-rose-600">
                  {form.formState.errors.department_id.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pr-required-date" className="text-xs font-medium text-slate-700">
                Required Date <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="pr-required-date"
                type="date"
                className="font-mono"
                {...form.register("required_date")}
              />
              {form.formState.errors.required_date && (
                <p className="text-xs text-rose-600">
                  {form.formState.errors.required_date.message}
                </p>
              )}
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="pr-justification" className="text-xs font-medium text-slate-700">
                Business Justification <span className="text-rose-500">*</span>
              </Label>
              <Textarea
                id="pr-justification"
                rows={3}
                placeholder="Explain operational impact, expected efficiency gain, or compliance requirement..."
                {...form.register("justification")}
              />
              {form.formState.errors.justification && (
                <p className="text-xs text-rose-600">
                  {form.formState.errors.justification.message}
                </p>
              )}
            </div>
          </div>

          {/* Decimal-safe total preview box */}
          <div className="flex items-center justify-between rounded-xl border border-teal-200/80 bg-teal-50/60 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Calculator className="size-4 text-teal-700" />
              <div>
                <p className="text-xs font-semibold text-teal-950">
                  Calculated Request Total
                </p>
                <p className="text-[11px] text-teal-700">
                  Enforced on PostgreSQL via generated NUMERIC(18,2) column
                </p>
              </div>
            </div>
            <span className="font-mono text-base font-bold text-teal-950 tabular-nums">
              {formatCents(previewTotalCents, currency)}
            </span>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>

            {editingDraft ? (
              <Button type="submit" disabled={isSubmitting} className="gap-1.5">
                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save Draft Changes
              </Button>
            ) : (
              <>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={isSubmitting}
                  onClick={() => setSubmitMode("draft")}
                  className="gap-1.5"
                >
                  {isSubmitting && submitMode === "draft" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save as Draft
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  onClick={() => setSubmitMode("submit")}
                  className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
                >
                  {isSubmitting && submitMode === "submit" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Submit for Approval
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
