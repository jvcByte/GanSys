import { handleRoute, parseJson, requireApiUser } from "@/lib/api";
import { updateProfile } from "@/lib/data";
import { profileSchema } from "@/lib/validators";

export const runtime = "nodejs";

export const PATCH = handleRoute(async (request: Request) => {
  const user = await requireApiUser();
  const body = await parseJson(request, profileSchema);
  const updated = await updateProfile(user.id, body);
  return { user: updated };
});
