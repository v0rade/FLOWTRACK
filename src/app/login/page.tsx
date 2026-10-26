import { LoginClient } from "@/components/flowtrack/login-client";
import { isLiveSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginClient isDemoMode={!isLiveSupabaseConfigured()} />;
}
