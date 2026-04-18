import { handleRoute, jsonOk, parseJson, requireApiUser } from "@/lib/api";
import { createController, getDashboardSnapshot } from "@/lib/data";
import { controllerSchema } from "@/lib/validators";

export const runtime = "nodejs";

export const GET = handleRoute(async () => {
  const user = await requireApiUser();
  return await getDashboardSnapshot(user.id);
});

export const POST = handleRoute(async (request: Request) => {
  const user = await requireApiUser();
  const body = await parseJson(request, controllerSchema);
  return jsonOk(await createController(user.id, body), { status: 201 });
});
