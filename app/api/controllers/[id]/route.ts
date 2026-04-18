import { getRouteParams, handleRoute, parseJson, requireApiUser, type RouteContext } from "@/lib/api";
import { deleteController, getControllerSnapshot, updateController } from "@/lib/data";
import { controllerPatchSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = RouteContext<{ id: string }>;

export const GET = handleRoute(async (_: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  return await getControllerSnapshot(user.id, id);
});

export const PATCH = handleRoute(async (request: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  const body = await parseJson(request, controllerPatchSchema);
  return { controller: await updateController(user.id, id, body) };
});

export const DELETE = handleRoute(async (_: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  return await deleteController(user.id, id);
});
