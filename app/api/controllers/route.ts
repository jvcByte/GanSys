import { ApiError, jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { createController, getDashboardSnapshot } from "@/lib/data";
import { controllerSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    return jsonOk(getDashboardSnapshot(user.id));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = controllerSchema.parse(await request.json());
    const created = createController(user.id, body);
    return jsonOk(created, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError(new ApiError("Invalid JSON payload.", 400));
    }
    return jsonError(error);
  }
}
