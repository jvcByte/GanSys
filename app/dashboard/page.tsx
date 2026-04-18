import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }
  const snapshot = await getDashboardSnapshot(user.id);
  return <DashboardHome initialSnapshot={snapshot} />;
}
