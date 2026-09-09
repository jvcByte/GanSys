import { handleRoute, jsonOk, requireApiUser, ApiError, getRouteParams, type RouteContext } from "@/lib/api";
import { revokeCertificate, getCertificate } from "@/lib/data";

export const runtime = "nodejs";

type Params = { certificateId: string };

/**
 * GET /api/passports/certificates/:certificateId
 * Returns certificate details (auth required for ownership check).
 */
export const GET = handleRoute(async (context: RouteContext<Params>) => {
  const user = await requireApiUser();
  const { certificateId } = await getRouteParams(context);

  // Ownership check: only the issuing user can fetch this via the authenticated API.
  const cert = await getCertificate(certificateId, user.id);

  if (!cert) {
    throw new ApiError("Certificate not found", 404);
  }

  return jsonOk(cert);
});

/**
 * POST /api/passports/certificates/:certificateId (with ?action=revoke)
 * Revokes a certificate.
 */
export const POST = handleRoute(async (request: Request, context: RouteContext<Params>) => {
  const user = await requireApiUser();
  const { certificateId } = await getRouteParams(context);
  
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  
  if (action !== "revoke") {
    throw new ApiError("Invalid action. Use ?action=revoke", 400);
  }
  
  try {
    await revokeCertificate(user.id, certificateId);
    return jsonOk({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Certificate not found") {
        throw new ApiError(error.message, 404);
      }
      throw new ApiError(error.message, 400);
    }
    throw error;
  }
});
