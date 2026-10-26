"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  CheckSquare,
  ChevronDown,
  FileSpreadsheet,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  RotateCcw,
  Settings,
  ShieldAlert,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "./status-badge";
import { DEMO_PERSONAS } from "@/lib/supabase/config";
import {
  resetDemoDataAction,
  signOutAction,
  switchDemoPersonaAction,
} from "@/app/actions";
import type { AppSessionContext, EnrichedApprovalAction } from "@/lib/data";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

export function AppShell({
  context,
  recentActivity,
  children,
}: {
  context: AppSessionContext;
  recentActivity: (EnrichedApprovalAction & {
    request_number: string;
    item_name: string;
    department_code: string;
  })[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [personaOpen, setPersonaOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const navItems: NavItem[] = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/requests", label: "Purchase Requests", icon: FileSpreadsheet },
    {
      href: "/approvals",
      label: "Approvals",
      icon: CheckSquare,
      badge: context.pendingApprovalCount > 0 ? context.pendingApprovalCount : undefined,
    },
    { href: "/reports", label: "Reports & Analytics", icon: BarChart3 },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  function handleSwitchPersona(personaId: string) {
    setPersonaOpen(false);
    startTransition(async () => {
      const res = await switchDemoPersonaAction(personaId);
      if (res.ok) {
        toast.success(res.message ?? "Persona switched");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleResetDemo() {
    setPersonaOpen(false);
    startTransition(async () => {
      const res = await resetDemoDataAction();
      if (res.ok) {
        toast.success(res.message ?? "Demo data reset");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleSignOut() {
    startTransition(async () => {
      const res = await signOutAction();
      if (res.ok) {
        toast.success("Signed out");
        router.push("/login");
        router.refresh();
      }
    });
  }

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#0b1528] text-slate-200 select-none">
      {/* Brand header */}
      <div className="flex h-16 items-center justify-between border-b border-slate-800/80 px-5">
        <Link href="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
          <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-sky-500 text-slate-950 shadow-sm">
            <Activity className="size-5 stroke-[2.4]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-white">FLOWTRACK</span>
              <span className="rounded bg-teal-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-300 border border-teal-500/30">
                OPS
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate max-w-[165px]">
              {context.settings.organization_name}
            </p>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Primary navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
        <div>
          <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Operations Workspace
          </p>
          <nav className="space-y-1" aria-label="Main navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-gradient-to-r from-teal-500/20 to-sky-500/10 text-white border border-teal-500/30 shadow-xs"
                      : "text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Icon
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        active ? "text-teal-400" : "text-slate-400 group-hover:text-slate-200",
                      )}
                    />
                    {item.label}
                  </span>
                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        "inline-flex items-center justify-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold",
                        active
                          ? "bg-teal-400 text-slate-950"
                          : "bg-amber-500/20 text-amber-300 border border-amber-400/30",
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Role & RLS Scope summary card inside sidebar */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <ShieldAlert className="size-3.5 text-teal-400" />
              Active RLS Policy Scope
            </span>
            <span className="font-mono text-[10px] uppercase text-teal-300">Enforced</span>
          </div>
          <p className="text-slate-400 leading-relaxed">
            {context.profile.role === "admin"
              ? "Administrator access: viewing and governing all departments, settings, and system audit logs."
              : context.profile.role === "manager"
                ? `Department Manager (${context.department?.code ?? "—"}): viewing and deciding requests for ${context.department?.name ?? "your department"}.`
                : `Employee (${context.department?.code ?? "—"}): viewing and managing only requests you created.`}
          </p>
        </div>
      </div>

      {/* Signed-in user card */}
      <div className="border-t border-slate-800/80 p-3.5 bg-slate-950/40">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {context.profile.full_name}
            </p>
            <p className="truncate text-xs text-slate-400">{context.profile.email}</p>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              <RoleBadge role={context.profile.role} />
              {context.department && (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 border border-slate-700">
                  {context.department.code}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleSignOut}
            disabled={isPending}
            title="Sign out"
            className="text-slate-400 hover:bg-slate-800 hover:text-white shrink-0"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:w-64 lg:flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar backdrop + drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative flex w-72 max-w-[85vw] flex-1 flex-col">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="size-5" />
              </button>

              {/* Demo data notice badge */}
              <div className="flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50/80 px-3 py-1 text-xs text-teal-900">
                <FlaskConical className="size-3.5 text-teal-600 shrink-0" />
                <span className="font-medium truncate">
                  Demo Environment: <span className="hidden sm:inline">Fictional sample data — not actual customer metrics</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Interactive Demo Persona Switcher */}
              {context.isDemoMode && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setPersonaOpen((o) => !o);
                      setNotifOpen(false);
                    }}
                    disabled={isPending}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-2xs hover:bg-slate-100 transition-colors"
                  >
                    <UserCheck className="size-3.5 text-teal-600" />
                    <span className="hidden md:inline text-slate-500">Role Switcher:</span>
                    <span className="font-semibold text-slate-900">
                      {context.profile.full_name}
                    </span>
                    <span className="rounded bg-teal-600/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-800">
                      {context.profile.role.toUpperCase()}
                    </span>
                    <ChevronDown className="size-3.5 text-slate-400" />
                  </button>

                  {personaOpen && (
                    <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 bg-white p-2 shadow-xl z-40">
                      <div className="px-2.5 py-2 border-b border-slate-100">
                        <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                          <Sparkles className="size-3.5 text-teal-600" />
                          Instant Demo Persona Switcher
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Switch accounts to test PostgreSQL Row Level Security and multi-role approval workflows live.
                        </p>
                      </div>
                      <div className="my-1.5 space-y-1 max-h-72 overflow-y-auto">
                        {DEMO_PERSONAS.map((p) => {
                          const isCurrent = p.id === context.profile.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleSwitchPersona(p.id)}
                              disabled={isPending}
                              className={cn(
                                "w-full rounded-lg px-2.5 py-2 text-left transition-colors flex items-start justify-between gap-2",
                                isCurrent
                                  ? "bg-teal-50/90 border border-teal-200"
                                  : "hover:bg-slate-50 border border-transparent",
                              )}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-slate-900">
                                    {p.full_name}
                                  </span>
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700">
                                    {p.badge}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                                  {p.summary}
                                </p>
                              </div>
                              {isCurrent && (
                                <span className="shrink-0 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                                  Active
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t border-slate-100 pt-2 px-1 flex items-center justify-between gap-2">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={handleResetDemo}
                          disabled={isPending}
                          className="gap-1.5 text-xs"
                        >
                          <RotateCcw className="size-3" />
                          Reset Demo Database
                        </Button>
                        <Link
                          href="/login"
                          onClick={() => setPersonaOpen(false)}
                          className="text-xs font-medium text-teal-700 hover:underline px-2"
                        >
                          Auth Login Page →
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Activity & Notification Bell */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen((o) => !o);
                    setPersonaOpen(false);
                  }}
                  className="relative inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
                  aria-label="Workflow notifications"
                >
                  <Bell className="size-4" />
                  {context.pendingApprovalCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-teal-600 font-mono text-[10px] font-bold text-white">
                      {context.pendingApprovalCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-40">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-xs font-semibold text-slate-900">
                        Workflow Notifications & History
                      </span>
                      <Link
                        href="/approvals"
                        onClick={() => setNotifOpen(false)}
                        className="text-xs font-medium text-teal-700 hover:underline"
                      >
                        Approval Queue ({context.pendingApprovalCount})
                      </Link>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto my-1">
                      {recentActivity.length === 0 ? (
                        <p className="py-6 text-center text-xs text-slate-400">
                          No recent workflow events for your scope.
                        </p>
                      ) : (
                        recentActivity.slice(0, 6).map((act) => (
                          <div key={act.id} className="py-2 text-xs space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-teal-700">
                                {act.request_number}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {new Date(act.created_at).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </div>
                            <p className="text-slate-700 truncate font-medium">{act.item_name}</p>
                            <p className="text-[11px] text-slate-500">
                              <span className="font-medium text-slate-700">{act.actor_name}</span>{" "}
                              marked as <span className="font-medium">{act.action.replace("_", " ")}</span>
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page body */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>

        {/* Footer with portfolio attribution & demo data disclaimer */}
        <footer className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6 lg:px-8 text-xs text-slate-500">
          <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <p>
              <strong className="font-semibold text-slate-700">FLOWTRACK</strong> — Independent portfolio
              application demonstrating internal purchase request digitization, approval automation, and
              operational analytics.
            </p>
            <p className="text-slate-400">
              Inspired by digital transformation principles in the Cerlang Digital 2026 profile · Not an
              official Cerlang Digital product · Sample metrics are fictional demo data.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
