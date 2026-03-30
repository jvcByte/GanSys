import { ApiError, jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { updateProfile } from "@/lib/data";
import { profileSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const body = profileSchema.parse(await request.json());
    const updated = updateProfile(user.id, body);
    return jsonOk({ user: updated });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError(new ApiError("Invalid JSON payload.", 400));
    }
    return jsonError(error);
  }
}
