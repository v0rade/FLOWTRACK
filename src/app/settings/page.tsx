import { redirect } from "next/navigation";
import { AppShell } from "@/components/flowtrack/app-shell";
import { SettingsClient } from "@/components/flowtrack/settings-client";
import {
  getAppContext,
  listAuditLogs,
  listProfilesDirectory,
  listRecentActivity,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await getAppContext();
  if (!context) {
    redirect("/login");
  }

  const [directory, auditLogs, recentActivity] = await Promise.all([
    listProfilesDirectory(),
    listAuditLogs(50),
    listRecentActivity(10),
  ]);

  return (
    <AppShell context={context} recentActivity={recentActivity}>
      <SettingsClient
        context={context}
        directory={directory}
        auditLogs={auditLogs}
      />
    </AppShell>
  );
}
