import {
  CheckCircle2,
  Clock,
  FileEdit,
  Ban,
  XCircle,
  ShieldCheck,
  UserCheck,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, STATUS_LABELS } from "@/lib/workflow";
import type { RequestStatus, Role } from "@/lib/types";

const STATUS_STYLES: Record<
  RequestStatus,
  { className: string; icon: typeof Clock }
> = {
  draft: {
    className: "bg-slate-100 text-slate-700 border-slate-200",
    icon: FileEdit,
  },
  pending_approval: {
    className: "bg-amber-50 text-amber-800 border-amber-200",
    icon: Clock,
  },
  approved: {
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
    icon: CheckCircle2,
  },
  rejected: {
    className: "bg-rose-50 text-rose-800 border-rose-200",
    icon: XCircle,
  },
  cancelled: {
    className: "bg-slate-100 text-slate-500 border-slate-200 line-through decoration-slate-400",
    icon: Ban,
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: RequestStatus;
  className?: string;
}) {
  const cfg = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        cfg.className,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {STATUS_LABELS[status]}
    </span>
  );
}

const ROLE_STYLES: Record<Role, { className: string; icon: typeof User }> = {
  employee: {
    className: "bg-sky-50 text-sky-800 border-sky-200",
    icon: User,
  },
  manager: {
    className: "bg-teal-50 text-teal-800 border-teal-200",
    icon: UserCheck,
  },
  admin: {
    className: "bg-indigo-50 text-indigo-800 border-indigo-200",
    icon: ShieldCheck,
  },
};

export function RoleBadge({
  role,
  className,
}: {
  role: Role;
  className?: string;
}) {
  const cfg = ROLE_STYLES[role] ?? ROLE_STYLES.employee;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        cfg.className,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" />
      {ROLE_LABELS[role]}
    </span>
  );
}
