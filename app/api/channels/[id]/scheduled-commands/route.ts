import { getRouteParams, handleRoute, jsonOk, parseJson, requireApiUser, type RouteContext } from "@/lib/api";
import { createScheduledCommand } from "@/lib/services/scheduled-command.service";
import { scheduledCommandSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = RouteContext<{ id: string }>;

export const POST = handleRoute(async (request: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  const body = await parseJson(request, scheduledCommandSchema);
  
  const scheduledCommand = await createScheduledCommand(user.id, id, {
    desiredBooleanState: body.desiredBooleanState,
    desiredNumericValue: body.desiredNumericValue,
    note: body.note,
    scheduledFor: new Date(body.scheduledFor),
  });
  
  return jsonOk({ scheduledCommand }, { status: 201 });
});
