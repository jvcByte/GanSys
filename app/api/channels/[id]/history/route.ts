import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { getChannelHistory } from "@/lib/data";
import { historyQuerySchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const url = new URL(request.url);
    const query = historyQuerySchema.parse({
      range: url.searchParams.get("range") ?? "24h",
    });
    return jsonOk({ points: getChannelHistory(user.id, id, query.range) });
  } catch (error) {
    return jsonError(error);
  }
}
