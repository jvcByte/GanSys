import { redirect } from "next/navigation";
import { AddDeviceWizard } from "@/components/dashboard/onboarding/add-device-wizard";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const snapshot = await getDashboardSnapshot(user.id);
  
  return (
    <div style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <AddDeviceWizard initialSnapshot={snapshot} />
    </div>
  );
}