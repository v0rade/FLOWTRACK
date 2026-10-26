"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  History,
  Loader2,
  Lock,
  Plus,
  Save,
  ShieldCheck,
  Sliders,
  User,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RoleBadge } from "./status-badge";
import { DEMO_PERSONAS } from "@/lib/supabase/config";
import {
  adminUpdateProfileAction,
  adminUpsertDepartmentAction,
  switchDemoPersonaAction,
  updateAppSettingsAction,
  updateOwnProfileAction,
} from "@/app/actions";
import type {
  AppSessionContext,
  EnrichedAuditLog,
} from "@/lib/data";
import type { Profile, Role } from "@/lib/types";

export function SettingsClient({
  context,
  directory,
  auditLogs,
}: {
  context: AppSessionContext;
  directory: (Profile & {
    department_code: string | null;
    department_name: string | null;
  })[];
  auditLogs: EnrichedAuditLog[];
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"rules" | "directory" | "departments" | "profile" | "audit">(
    "rules",
  );
  const [isPending, startTransition] = React.useTransition();

  // Profile form state
  const [fullName, setFullName] = React.useState(context.profile.full_name);

  // App Settings form state
  const [orgName, setOrgName] = React.useState(context.settings.organization_name);
  const [currency, setCurrency] = React.useState(context.settings.currency);
  const [allowSelfApproval, setAllowSelfApproval] = React.useState(
    context.settings.allow_self_approval,
  );
  const [manualMins, setManualMins] = React.useState(
    String(context.settings.manual_minutes_per_request),
  );
  const [digitalMins, setDigitalMins] = React.useState(
    String(context.settings.digital_minutes_per_request),
  );
  const [manualDays, setManualDays] = React.useState(
    String(Number(context.settings.manual_cycle_days)),
  );
  const [hourlyCost, setHourlyCost] = React.useState(context.settings.hourly_staff_cost);

  // New department state
  const [deptCode, setDeptCode] = React.useState("");
  const [deptName, setDeptName] = React.useState("");

  const [prevKey, setPrevKey] = React.useState(
    `${context.profile.id}:${context.profile.full_name}:${context.settings.updated_at}`,
  );
  const currentKey = `${context.profile.id}:${context.profile.full_name}:${context.settings.updated_at}`;
  if (prevKey !== currentKey) {
    setPrevKey(currentKey);
    setFullName(context.profile.full_name);
    setOrgName(context.settings.organization_name);
    setCurrency(context.settings.currency);
    setAllowSelfApproval(context.settings.allow_self_approval);
    setManualMins(String(context.settings.manual_minutes_per_request));
    setDigitalMins(String(context.settings.digital_minutes_per_request));
    setManualDays(String(Number(context.settings.manual_cycle_days)));
    setHourlyCost(context.settings.hourly_staff_cost);
  }

  const isAdmin = context.profile.role === "admin";

  function handleSwitchToAdmin() {
    const nadia = DEMO_PERSONAS.find((p) => p.role === "admin");
    if (!nadia) return;
    startTransition(async () => {
      const res = await switchDemoPersonaAction(nadia.id);
      if (res.ok) {
        toast.success(res.message ?? "Switched to Administrator");
        router.refresh();
      }
    });
  }

  function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateAppSettingsAction({
        organization_name: orgName,
        currency,
        allow_self_approval: allowSelfApproval,
        manual_minutes_per_request: Number(manualMins),
        digital_minutes_per_request: Number(digitalMins),
        manual_cycle_days: Number(manualDays),
        hourly_staff_cost: hourlyCost,
      });
      if (res.ok) {
        toast.success(res.message ?? "Settings saved");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleSaveOwnProfile(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateOwnProfileAction({ full_name: fullName });
      if (res.ok) {
        toast.success(res.message ?? "Profile updated");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleAdminUpdateUser(userId: string, role: Role, departmentId: string | null) {
    startTransition(async () => {
      const res = await adminUpdateProfileAction({
        user_id: userId,
        role,
        department_id: departmentId,
      });
      if (res.ok) {
        toast.success(res.message ?? "User updated");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleCreateDepartment(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await adminUpsertDepartmentAction({
        id: null,
        code: deptCode,
        name: deptName,
        is_active: true,
      });
      if (res.ok) {
        toast.success(res.message ?? "Department created");
        setDeptCode("");
        setDeptName("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleToggleDepartment(id: string, code: string, name: string, active: boolean) {
    startTransition(async () => {
      const res = await adminUpsertDepartmentAction({
        id,
        code,
        name,
        is_active: active,
      });
      if (res.ok) {
        toast.success("Department status updated");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            System Governance, Business Rules & Audit Log
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Configure approval rules, illustrative ROI assumptions, user roles, departments, and inspect row-level database audit logs.
          </p>
        </div>

        {!isAdmin && context.isDemoMode && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={handleSwitchToAdmin}
            className="gap-1.5 border-teal-200 bg-teal-50/70 text-teal-900 hover:bg-teal-100"
          >
            <UserCheck className="size-3.5 text-teal-600" />
            Switch to Nadia Putri (Admin) to Edit Rules
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-3">
        {[
          { id: "rules", label: "Business Rules & ROI Assumptions", icon: Sliders },
          { id: "directory", label: `Users & Role Permissions (${directory.length})`, icon: Users },
          { id: "departments", label: `Departments (${context.departments.length})`, icon: Building2 },
          { id: "profile", label: "My Profile", icon: User },
          { id: "audit", label: `Database Audit Logs (${auditLogs.length})`, icon: History },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as typeof tab)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                active
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Icon className="size-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Business Rules & ROI Assumptions */}
      {tab === "rules" && (
        <form
          onSubmit={handleSaveSettings}
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs space-y-6 max-w-3xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Organization & Approval Governance Rules
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Stored in <code className="font-mono">public.app_settings</code> and enforced inside PostgreSQL <code className="font-mono">decide_purchase_request()</code>.
              </p>
            </div>
            {!isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                <Lock className="size-3.5" /> Admin Only
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="st-org" className="text-xs font-medium">
                Organization Name
              </Label>
              <Input
                id="st-org"
                disabled={!isAdmin || isPending}
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="st-currency" className="text-xs font-medium">
                ISO Currency Code
              </Label>
              <Input
                id="st-currency"
                disabled={!isAdmin || isPending}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                className="font-mono uppercase"
              />
            </div>

            <div className="sm:col-span-2 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  Permit Managers/Admins to Approve Their Own Requests (Self-Approval)
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  When disabled (recommended internal control), PostgreSQL rejects any attempt by a user to approve or reject a request where <code className="font-mono">requester_id = auth.uid()</code>.
                </p>
              </div>
              <input
                type="checkbox"
                aria-label="Allow self-approval"
                disabled={!isAdmin || isPending}
                checked={allowSelfApproval}
                onChange={(e) => setAllowSelfApproval(e.target.checked)}
                className="size-4 accent-teal-600 rounded"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Configurable Illustrative Assumptions (Before & After Comparison)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                These parameters drive the estimated time and labor cost savings in the Process Comparison panel. They are clearly labeled as illustrative assumptions, separate from measured approval timestamps.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="st-manual-min" className="text-xs font-medium">
                  Assumed Manual Handling Time (minutes / request)
                </Label>
                <Input
                  id="st-manual-min"
                  type="number"
                  min={1}
                  disabled={!isAdmin || isPending}
                  value={manualMins}
                  onChange={(e) => setManualMins(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="st-digital-min" className="text-xs font-medium">
                  Assumed Digital Handling Time (minutes / request)
                </Label>
                <Input
                  id="st-digital-min"
                  type="number"
                  min={1}
                  disabled={!isAdmin || isPending}
                  value={digitalMins}
                  onChange={(e) => setDigitalMins(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="st-manual-days" className="text-xs font-medium">
                  Assumed Legacy Approval Cycle (days)
                </Label>
                <Input
                  id="st-manual-days"
                  type="number"
                  step="0.5"
                  min={0.5}
                  disabled={!isAdmin || isPending}
                  value={manualDays}
                  onChange={(e) => setManualDays(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="st-hourly-cost" className="text-xs font-medium">
                  Assumed Hourly Staff Cost ({currency})
                </Label>
                <Input
                  id="st-hourly-cost"
                  disabled={!isAdmin || isPending}
                  value={hourlyCost}
                  onChange={(e) => setHourlyCost(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={isPending}
                className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save Governance & ROI Settings
              </Button>
            </div>
          )}
        </form>
      )}

      {/* Tab 2: Users & Role Directory */}
      {tab === "directory" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Role-Based Access Control (RBAC) Directory
              </h2>
              <p className="text-xs text-slate-500">
                Administrators can reassign roles (Employee, Manager, Administrator) and departments. Changes immediately update PostgreSQL RLS visibility.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">User</th>
                  <th className="px-4 py-2.5 font-semibold">Email</th>
                  <th className="px-4 py-2.5 font-semibold">Current Role</th>
                  <th className="px-4 py-2.5 font-semibold">Assigned Department</th>
                  {isAdmin && <th className="px-4 py-2.5 font-semibold text-right">Admin Control</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {directory.map((u) => (
                  <UserDirectoryRow
                    key={u.id}
                    user={u}
                    departments={context.departments}
                    isAdmin={isAdmin}
                    isSelf={u.id === context.profile.id}
                    disabled={isPending}
                    onSave={handleAdminUpdateUser}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Departments */}
      {tab === "departments" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">
                Organizational Departments
              </h2>
              <p className="text-xs text-slate-500">
                Purchase requests and manager approval scopes are partitioned by department.
              </p>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Code</th>
                  <th className="px-4 py-2.5 font-semibold">Department Name</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  {isAdmin && <th className="px-4 py-2.5 font-semibold text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {context.departments.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2.5 font-mono font-bold text-teal-800">{d.code}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{d.name}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          d.is_active
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {d.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={isPending}
                          onClick={() =>
                            handleToggleDepartment(d.id, d.code, d.name, !d.is_active)
                          }
                        >
                          {d.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <form
              onSubmit={handleCreateDepartment}
              className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4 h-fit"
            >
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Add New Department</h3>
                <p className="text-xs text-slate-500">
                  Create a new cost center for purchase requests and approvals.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-dept-code" className="text-xs font-medium">
                  Department Code (2-10 uppercase chars)
                </Label>
                <Input
                  id="new-dept-code"
                  placeholder="e.g., QA"
                  value={deptCode}
                  onChange={(e) => setDeptCode(e.target.value.toUpperCase())}
                  className="font-mono uppercase"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-dept-name" className="text-xs font-medium">
                  Department Name
                </Label>
                <Input
                  id="new-dept-name"
                  placeholder="e.g., Quality Assurance"
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={isPending}
                className="w-full gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
              >
                <Plus className="size-3.5" />
                Create Department
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Tab 4: My Profile */}
      {tab === "profile" && (
        <form
          onSubmit={handleSaveOwnProfile}
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs space-y-4 max-w-lg"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900">My Profile</h2>
            <p className="text-xs text-slate-500">
              Update your display name. Role and department assignments are controlled by Administrators.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prof-name" className="text-xs font-medium">
              Full Name
            </Label>
            <Input
              id="prof-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs pt-1">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">Assigned Role</p>
              <div className="mt-1">
                <RoleBadge role={context.profile.role} />
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">Department</p>
              <p className="font-mono font-semibold text-slate-900 mt-1">
                {context.department
                  ? `${context.department.code} — ${context.department.name}`
                  : "Unassigned"}
              </p>
            </div>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={isPending}
            className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
          >
            <Save className="size-3.5" />
            Update Display Name
          </Button>
        </form>
      )}

      {/* Tab 5: Immutable Audit Logs */}
      {tab === "audit" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="size-4 text-teal-600" />
              Append-Only PostgreSQL Audit Logs
            </h2>
            <p className="text-xs text-slate-500">
              Captured automatically by <code className="font-mono">write_audit_log()</code> triggers and protected by <code className="font-mono">audit_logs_append_only</code>.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Log #</th>
                  <th className="px-4 py-2.5 font-semibold">Timestamp</th>
                  <th className="px-4 py-2.5 font-semibold">Actor</th>
                  <th className="px-4 py-2.5 font-semibold">Entity</th>
                  <th className="px-4 py-2.5 font-semibold">Operation</th>
                  <th className="px-4 py-2.5 font-semibold">Changed Fields</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-mono text-slate-500">#{l.id}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {l.actor_name}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-teal-800">
                      {l.entity_type}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800">
                      {l.operation}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600 max-w-md truncate">
                      {l.changed_fields.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function UserDirectoryRow({
  user,
  departments,
  isAdmin,
  isSelf,
  disabled,
  onSave,
}: {
  user: Profile & { department_code: string | null; department_name: string | null };
  departments: AppSessionContext["departments"];
  isAdmin: boolean;
  isSelf: boolean;
  disabled: boolean;
  onSave: (userId: string, role: Role, departmentId: string | null) => void;
}) {
  const [role, setRole] = React.useState<Role>(user.role);
  const [deptId, setDeptId] = React.useState<string>(user.department_id ?? "");

  const [prevUserKey, setPrevUserKey] = React.useState(
    `${user.role}:${user.department_id ?? ""}`,
  );
  const currentUserKey = `${user.role}:${user.department_id ?? ""}`;
  if (prevUserKey !== currentUserKey) {
    setPrevUserKey(currentUserKey);
    setRole(user.role);
    setDeptId(user.department_id ?? "");
  }

  const dirty = role !== user.role || (deptId || null) !== user.department_id;

  return (
    <tr className="hover:bg-slate-50/80">
      <td className="px-4 py-2.5 font-semibold text-slate-900">{user.full_name}</td>
      <td className="px-4 py-2.5 font-mono text-slate-600">{user.email}</td>
      <td className="px-4 py-2.5">
        {isAdmin ? (
          <select
            aria-label={`Role for ${user.full_name}`}
            value={role}
            disabled={disabled || isSelf}
            onChange={(e) => setRole(e.target.value as Role)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
          >
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="admin">Administrator</option>
          </select>
        ) : (
          <RoleBadge role={user.role} />
        )}
      </td>
      <td className="px-4 py-2.5">
        {isAdmin ? (
          <select
            aria-label={`Department for ${user.full_name}`}
            value={deptId}
            disabled={disabled}
            onChange={(e) => setDeptId(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
          >
            <option value="">Unassigned</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-slate-700">
            {user.department_code ? `${user.department_code} — ${user.department_name}` : "—"}
          </span>
        )}
      </td>
      {isAdmin && (
        <td className="px-4 py-2.5 text-right">
          <Button
            size="xs"
            disabled={!dirty || disabled}
            onClick={() => onSave(user.id, role, deptId || null)}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            Save
          </Button>
        </td>
      )}
    </tr>
  );
}
