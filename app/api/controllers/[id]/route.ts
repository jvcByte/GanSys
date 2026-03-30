import { ApiError, jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { deleteController, getControllerSnapshot, updateController } from "@/lib/data";
import { controllerPatchSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return jsonOk(getControllerSnapshot(user.id, id));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const body = controllerPatchSchema.parse(await request.json());
    return jsonOk({ controller: updateController(user.id, id, body) });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError(new ApiError("Invalid JSON payload.", 400));
    }
    return jsonError(error);
  }
}

export async function DELETE(_: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return jsonOk(deleteController(user.id, id));
  } catch (error) {
    return jsonError(error);
  }
}
