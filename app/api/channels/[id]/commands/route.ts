import { getRouteParams, handleRoute, jsonOk, parseJson, requireApiUser, type RouteContext } from "@/lib/api";
import { createManualCommand } from "@/lib/data";
import { commandSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = RouteContext<{ id: string }>;

export const POST = handleRoute(async (request: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  const body = await parseJson(request, commandSchema);
  const command = await createManualCommand(user.id, id, body);
  return jsonOk({ command }, { status: 201 });
});
