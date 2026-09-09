import { handleRoute, jsonOk, parseJson, requireApiUser, ApiError, getRouteParams, type RouteContext } from "@/lib/api";
import { getPassportProfile, updatePassportProfile, deleteProfile } from "@/lib/data";
import { passportProfilePatchSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Params = { profileId: string };

/**
 * GET /api/passports/:profileId
 * Returns a single profile with compliance status for each rule.
 */
export const GET = handleRoute(async (context: RouteContext<Params>) => {
  const user = await requireApiUser();
  const { profileId } = await getRouteParams(context);

  const result = await getPassportProfile(user.id, profileId);

  if (!result) {
    throw new ApiError("Profile not found", 404);
  }

  return jsonOk(result);
});

/**
 * PATCH /api/passports/:profileId
 * Updates a passport profile.
 */
export const PATCH = handleRoute(async (request: Request, context: RouteContext<Params>) => {
  const user = await requireApiUser();
  const { profileId } = await getRouteParams(context);
  const body = await parseJson(request, passportProfilePatchSchema);

  try {
    const profile = await updatePassportProfile(user.id, profileId, body);
    return jsonOk(profile);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Profile not found") {
        throw new ApiError(error.message, 404);
      }
      throw new ApiError(error.message, 422);
    }
    throw error;
  }
});

/**
 * DELETE /api/passports/:profileId
 * Deletes a passport profile. Issued certificates are preserved (profileId set to NULL).
 */
export const DELETE = handleRoute(async (context: RouteContext<Params>) => {
  const user = await requireApiUser();
  const { profileId } = await getRouteParams(context);

  try {
    await deleteProfile(user.id, profileId);
    return jsonOk({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Profile not found") {
        throw new ApiError(error.message, 404);
      }
      throw new ApiError(error.message, 400);
    }
    throw error;
  }
});
