import { getRouteParams, handleRoute, jsonOk, requireApiUser, type RouteContext } from "@/lib/api";
import { cancelScheduledCommand } from "@/lib/services/scheduled-command.service";

export const runtime = "nodejs";

type Context = RouteContext<{ id: string }>;

export const DELETE = handleRoute(async (request: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  
  const scheduledCommand = await cancelScheduledCommand(user.id, id);
  
  return jsonOk({ scheduledCommand });
});
