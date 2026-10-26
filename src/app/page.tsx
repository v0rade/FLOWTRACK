import { redirect } from "next/navigation";
import { AppShell } from "@/components/flowtrack/app-shell";
import { OverviewClient } from "@/components/flowtrack/overview-client";
import {
  getAppContext,
  listRecentActivity,
  listVisibleRequests,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const context = await getAppContext();
  if (!context) {
    redirect("/login");
  }

  const [requests, recentActivity] = await Promise.all([
    listVisibleRequests(),
    listRecentActivity(12),
  ]);

  return (
    <AppShell context={context} recentActivity={recentActivity}>
      <OverviewClient
        context={context}
        requests={requests}
        recentActivity={recentActivity}
      />
    </AppShell>
  );
}
