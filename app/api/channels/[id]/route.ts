import { getRouteParams, handleRoute, parseJson, requireApiUser, type RouteContext } from "@/lib/api";
import { deleteChannel, updateChannel } from "@/lib/data";
import { channelPatchSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = RouteContext<{ id: string }>;

export const PATCH = handleRoute(async (request: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  const body = await parseJson(request, channelPatchSchema);
  return { channel: await updateChannel(user.id, id, body) };
});

export const DELETE = handleRoute(async (_: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  return await deleteChannel(user.id, id);
});
