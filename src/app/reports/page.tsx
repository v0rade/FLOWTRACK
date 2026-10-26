import { redirect } from "next/navigation";
import { AppShell } from "@/components/flowtrack/app-shell";
import { ReportsClient } from "@/components/flowtrack/reports-client";
import {
  getAppContext,
  listRecentActivity,
  listVisibleRequests,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const context = await getAppContext();
  if (!context) {
    redirect("/login");
  }

  const [requests, recentActivity] = await Promise.all([
    listVisibleRequests(),
    listRecentActivity(10),
  ]);

  return (
    <AppShell context={context} recentActivity={recentActivity}>
      <ReportsClient context={context} requests={requests} />
    </AppShell>
  );
}
