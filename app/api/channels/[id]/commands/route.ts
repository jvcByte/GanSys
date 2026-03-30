import { ApiError, jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { createManualCommand } from "@/lib/data";
import { commandSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const body = commandSchema.parse(await request.json());
    return jsonOk({ command: createManualCommand(user.id, id, body) }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError(new ApiError("Invalid JSON payload.", 400));
    }
    return jsonError(error);
  }
}
