import { SettingsView } from "@/components/dashboard/settings-view";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }
  const snapshot = getDashboardSnapshot(user.id);
  return <SettingsView initialSnapshot={snapshot} />;
}
