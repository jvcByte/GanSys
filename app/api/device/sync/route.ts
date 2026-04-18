import { ApiError, handleRoute, parseJson } from "@/lib/api";
import { deviceSync } from "@/lib/data";
import { deviceSyncSchema } from "@/lib/validators";

export const runtime = "nodejs";

export const POST = handleRoute(async (request: Request) => {
  const hardwareId = request.headers.get("x-device-id");
  const deviceKey = request.headers.get("x-device-key");
  if (!hardwareId || !deviceKey) {
    throw new ApiError("Missing x-device-id or x-device-key header.", 401);
  }
  try {
    const body = await parseJson(request, deviceSyncSchema);
    return await deviceSync(hardwareId, deviceKey, body);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized device.") {
      throw new ApiError(error.message, 401);
    }
    throw error;
  }
});
