import { redirect } from "next/navigation";

import { AppShell } from "@/components/dashboard/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { WsProvider } from "@/lib/ws-context";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <WsProvider>
      <AppShell user={user}>{children}</AppShell>
    </WsProvider>
  );
}
