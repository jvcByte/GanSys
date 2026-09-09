import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { PassportsView } from "@/components/dashboard/passports-view";

export const dynamic = "force-dynamic";

export default async function PassportsPage() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect("/login");
  }

  return <PassportsView user={user} />;
}
