import { getCurrentUser } from "@/lib/auth";
import { getDashboardSnapshot } from "@/lib/data";
import { ControllersPageClient } from "./client";

export const dynamic = "force-dynamic";

export default async function ControllersPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const snapshot = await getDashboardSnapshot(user.id);
  return <ControllersPageClient initialSnapshot={snapshot} />;
}
