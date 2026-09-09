import { handleRoute, jsonOk, parseJson, requireApiUser, ApiError } from "@/lib/api";
import { previewCompliance } from "@/lib/data";
import { passportPreviewSchema } from "@/lib/validators";

export const runtime = "nodejs";

/**
 * POST /api/passports/preview
 * Evaluates an unsaved set of rules against current telemetry so the profile
 * form can show live compliance feedback (and warn about strict bands)
 * before the policy is persisted. Server-side evaluation only.
 */
export const POST = handleRoute(async (request: Request) => {
  const user = await requireApiUser();
  const body = await parseJson(request, passportPreviewSchema);

  try {
    const results = await previewCompliance(user.id, body);
    return jsonOk({ results });
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError(error.message, 422);
    }
    throw error;
  }
});
