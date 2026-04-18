import { getRouteParams, handleRoute, parseJson, requireApiUser, type RouteContext } from "@/lib/api";
import { getPestSchedule, upsertPestSchedule } from "@/lib/data";
import { publishCommands } from "@/lib/mqtt/client";
import { pestScheduleSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = RouteContext<{ id: string }>;

export const GET = handleRoute(async (_: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  return { schedule: await getPestSchedule(user.id, id) };
});

export const PUT = handleRoute(async (request: Request, context: Context) => {
  const user = await requireApiUser();
  const { id } = await getRouteParams(context);
  const body = await parseJson(request, pestScheduleSchema);
  const schedule = await upsertPestSchedule(user.id, id, {
    enabled: body.enabled,
    sprayEntries: body.sprayEntries,
    uvStartTime: body.uvStartTime ?? null,
    uvEndTime: body.uvEndTime ?? null,
  });

  // Push updated schedule to device immediately via MQTT.
  publishCommands(id, { pestControlSchedule: schedule });

  return { schedule };
});
