import { ApiError, jsonError, jsonOk } from "@/lib/api";
import { deviceSync } from "@/lib/data";
import { deviceSyncSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const hardwareId = request.headers.get("x-device-id");
    const deviceKey = request.headers.get("x-device-key");
    if (!hardwareId || !deviceKey) {
      throw new ApiError("Missing x-device-id or x-device-key header.", 401);
    }
    const body = deviceSyncSchema.parse(await request.json());
    return jsonOk(deviceSync(hardwareId, deviceKey, body));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError(new ApiError("Invalid JSON payload.", 400));
    }
    if (error instanceof Error && error.message === "Unauthorized device.") {
      return jsonError(new ApiError(error.message, 401));
    }
    return jsonError(error);
  }
}
