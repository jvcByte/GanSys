import { createSession, setSessionCookie } from "@/lib/auth";
import { ApiError, jsonError, jsonOk } from "@/lib/api";
import { loginUser } from "@/lib/data";
import { loginSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await request.json());
    const user = await loginUser(body);
    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);
    return jsonOk({ user });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError(new ApiError("Invalid JSON payload.", 400));
    return jsonError(error);
  }
}
