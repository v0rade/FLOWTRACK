"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Lock,
  Loader2,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEMO_PERSONAS } from "@/lib/supabase/config";
import {
  signInAction,
  signUpAction,
  switchDemoPersonaAction,
} from "@/app/actions";

export function LoginClient({ isDemoMode }: { isDemoMode: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState(DEMO_PERSONAS[0].email);
  const [password, setPassword] = React.useState("FlowtrackDemo#2026");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res =
        mode === "signin"
          ? await signInAction({ email, password })
          : await signUpAction({ full_name: fullName, email, password });

      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Authenticated");
      router.push("/");
      router.refresh();
    });
  }

  function handlePersonaQuickLogin(personaId: string) {
    setError(null);
    startTransition(async () => {
      const res = await switchDemoPersonaAction(personaId);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Signed in");
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="min-h-screen bg-[#0b1528] text-slate-100 flex flex-col justify-between p-4 sm:p-8">
      <div className="max-w-5xl w-full mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left column: Value proposition & Demo Persona quick launch */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-300">
            <Sparkles className="size-3.5" />
            Smart Business Operations & Procurement Governance
          </div>

          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-sky-500 text-slate-950 shadow-md">
              <Activity className="size-6 stroke-[2.4]" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                FLOWTRACK
              </h1>
              <p className="text-xs sm:text-sm text-slate-400">
                Digitize purchase requests · Automate approvals · Measure process efficiency
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
            Experience how an enterprise replaces fragmented spreadsheets and chat approvals with server-validated purchase requests, PostgreSQL Row Level Security, append-only audit trails, and real-time operational KPI analytics.
          </p>

          {isDemoMode && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-teal-300 flex items-center gap-1.5">
                  <UserCheck className="size-4" />
                  1-Click Demo Role Sign-In (Nusantara Supplies Co.)
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  PostgreSQL RLS Active
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DEMO_PERSONAS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isPending}
                    onClick={() => handlePersonaQuickLogin(p.id)}
                    className="group rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left hover:border-teal-500/50 hover:bg-slate-900 transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white group-hover:text-teal-300">
                        {p.full_name}
                      </span>
                      <span className="rounded bg-teal-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-300">
                        {p.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                      {p.summary}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Credentials Sign In / Sign Up Card */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white text-slate-900 p-6 sm:p-7 shadow-2xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {mode === "signin" ? "Sign in to FLOWTRACK" : "Create Employee Account"}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {mode === "signin"
                  ? "Use your organization credentials or a demo account email"
                  : "New accounts default to Employee permissions via DB trigger"}
              </p>
            </div>
            <Lock className="size-4 text-teal-600" />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-name" className="text-xs font-medium text-slate-700">
                  Full Name
                </Label>
                <Input
                  id="auth-name"
                  placeholder="e.g., Andi Wijaya"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="auth-email" className="text-xs font-medium text-slate-700">
                Work Email
              </Label>
              <Input
                id="auth-email"
                type="email"
                placeholder="rina.wijaya@nusantara-demo.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auth-password" className="text-xs font-medium text-slate-700">
                Password
              </Label>
              <Input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button
              type="submit"
              disabled={isPending}
              className="w-full h-9 gap-1.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {mode === "signin" ? "Sign In" : "Create Account"}
            </Button>
          </form>

          <div className="flex items-center justify-between border-t border-slate-100 pt-4 text-xs">
            <span className="text-slate-500">
              {mode === "signin" ? "Need a new test account?" : "Already have an account?"}
            </span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode((m) => (m === "signin" ? "signup" : "signin"));
              }}
              className="font-semibold text-teal-700 hover:underline"
            >
              {mode === "signin" ? "Register Employee →" : "Back to Sign In →"}
            </button>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200/80 p-3 text-[11px] text-slate-500 flex items-start gap-2">
            <ShieldCheck className="size-4 text-teal-600 shrink-0 mt-0.5" />
            <span>
              <strong>Security Note:</strong> Sign-up metadata cannot escalate privileges; the PostgreSQL <code className="font-mono">on_auth_user_created</code> trigger strictly assigns <code className="font-mono">employee</code> role.
            </span>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-slate-500 mt-8">
        FLOWTRACK — Independent portfolio project inspired by digital transformation principles in the Cerlang Digital 2026 profile. Not an official Cerlang Digital product.
      </p>
    </div>
  );
}
