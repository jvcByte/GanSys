import { handleRoute, jsonOk, parseJson, requireApiUser, ApiError } from "@/lib/api";
import { getPassportOverview, createProfile } from "@/lib/data";
import { passportProfileSchema } from "@/lib/validators";

export const runtime = "nodejs";

/**
 * GET /api/passports
 * Returns all passport profiles and recent certificates for the authenticated user.
 */
export const GET = handleRoute(async () => {
  const user = await requireApiUser();
  return jsonOk(await getPassportOverview(user.id));
});

/**
 * POST /api/passports
 * Creates a new passport profile.
 */
export const POST = handleRoute(async (request: Request) => {
  const user = await requireApiUser();
  const body = await parseJson(request, passportProfileSchema);
  
  try {
    const profile = await createProfile(user.id, body);
    return jsonOk(profile, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError(error.message, 422);
    }
    throw error;
  }
});
