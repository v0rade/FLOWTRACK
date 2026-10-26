import { redirect } from "next/navigation";
import { AppShell } from "@/components/flowtrack/app-shell";
import { ApprovalsClient } from "@/components/flowtrack/approvals-client";
import {
  getAppContext,
  listRecentActivity,
  listVisibleRequests,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const context = await getAppContext();
  if (!context) {
    redirect("/login");
  }

  const [requests, recentActivity] = await Promise.all([
    listVisibleRequests(),
    listRecentActivity(15),
  ]);

  return (
    <AppShell context={context} recentActivity={recentActivity}>
      <ApprovalsClient
        context={context}
        requests={requests}
        recentActivity={recentActivity}
      />
    </AppShell>
  );
}
