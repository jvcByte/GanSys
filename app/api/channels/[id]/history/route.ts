import { getRouteParams, handleRoute, requireApiUser, type RouteContext } from "@/lib/api";
import { getChannelHistory } from "@/lib/data";
import { historyQuerySchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = RouteContext<{ id: string }>;

export const GET = handleRoute(async (request: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  const url = new URL(request.url);
  const query = historyQuerySchema.parse({
    range: url.searchParams.get("range") ?? "24h",
  });
  return { points: await getChannelHistory(user.id, id, query.range) };
});
