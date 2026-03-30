import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { getAlerts } from "@/lib/data";
import { alertQuerySchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const query = alertQuerySchema.parse({
      controllerId: url.searchParams.get("controllerId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    return jsonOk({ alerts: getAlerts(user.id, query) });
  } catch (error) {
    return jsonError(error);
  }
}
