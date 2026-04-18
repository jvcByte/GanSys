import { handleRoute, requireApiUser } from "@/lib/api";
import { getAlerts } from "@/lib/data";
import { alertQuerySchema } from "@/lib/validators";

export const runtime = "nodejs";

export const GET = handleRoute(async (request: Request) => {
  const user = await requireApiUser();
  const url = new URL(request.url);
  const query = alertQuerySchema.parse({
    controllerId: url.searchParams.get("controllerId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  return { alerts: await getAlerts(user.id, query) };
});
