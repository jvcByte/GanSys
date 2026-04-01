import { getCurrentUser } from "@/lib/auth";
import { HomeRedirect } from "@/components/home/home-redirect";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  return <HomeRedirect target={user ? "/dashboard" : "/login"} />;
}
