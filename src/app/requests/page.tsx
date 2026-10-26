import { redirect } from "next/navigation";
import { AppShell } from "@/components/flowtrack/app-shell";
import { RequestsClient } from "@/components/flowtrack/requests-client";
import {
  getAppContext,
  listRecentActivity,
  listVisibleRequests,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PurchaseRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const [context, params] = await Promise.all([getAppContext(), searchParams]);
  if (!context) {
    redirect("/login");
  }

  const [requests, recentActivity] = await Promise.all([
    listVisibleRequests(),
    listRecentActivity(10),
  ]);

  return (
    <AppShell context={context} recentActivity={recentActivity}>
      <RequestsClient
        context={context}
        requests={requests}
        initialOpenNew={params?.new === "1"}
      />
    </AppShell>
  );
}
