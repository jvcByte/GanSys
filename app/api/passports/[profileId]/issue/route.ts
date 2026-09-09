import { handleRoute, jsonOk, requireApiUser, ApiError, getRouteParams, type RouteContext } from "@/lib/api";
import { issueCertificate, type IssuanceResult } from "@/lib/data";

export const runtime = "nodejs";

type Params = { profileId: string };

/**
 * POST /api/passports/:profileId/issue
 * Issues a passport certificate for the profile.
 * 
 * Status codes:
 * - 201: Certificate issued successfully
 * - 404: Profile not found
 * - 409: Profile disabled or not compliant (body contains details)
 * - 422: Configuration error
 */
export const POST = handleRoute(async (context: RouteContext<Params>) => {
  const user = await requireApiUser();
  const { profileId } = await getRouteParams(context);
  
  try {
    const result: IssuanceResult = await issueCertificate(user.id, profileId);
    
    if (!result.success) {
      // Map error codes to appropriate status
      const status = result.code === "PROFILE_NOT_FOUND" ? 404 : 409;
      
      return jsonOk(
        {
          code: result.code,
          error: result.code,
          reasons: result.reasons,
        },
        { status }
      );
    }
    
    return jsonOk(result.certificate, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("PASSPORT_SIGNING_SECRET")) {
        throw new ApiError("Server configuration error: signing secret not configured", 500);
      }
      throw new ApiError(error.message, 422);
    }
    throw error;
  }
});
