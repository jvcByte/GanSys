import { getRouteParams, handleRoute, jsonOk, parseJson, requireApiUser, type RouteContext } from "@/lib/api";
import { createChannel } from "@/lib/data";
import { channelSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = RouteContext<{ id: string }>;

export const POST = handleRoute(async (request: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  const body = await parseJson(request, channelSchema);
  const channel = await createChannel(user.id, id, body);
  return jsonOk({ channel }, { status: 201 });
});
