import { getRouteParams, handleRoute, requireApiUser, type RouteContext } from "@/lib/api";
import { resetControllerKey } from "@/lib/data";

export const runtime = "nodejs";

type Context = RouteContext<{ id: string }>;

export const POST = handleRoute(async (_: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  return await resetControllerKey(user.id, id);
});
