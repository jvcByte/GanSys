import { getCurrentUser } from "@/lib/auth";
import { handleRoute } from "@/lib/api";

export const runtime = "nodejs";

export const GET = handleRoute(async () => {
  const user = await getCurrentUser();
  return { user };
});
