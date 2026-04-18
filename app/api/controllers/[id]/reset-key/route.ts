import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { resetControllerKey } from "@/lib/data";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return jsonOk(await resetControllerKey(user.id, id));
  } catch (error) {
    return jsonError(error);
  }
}
