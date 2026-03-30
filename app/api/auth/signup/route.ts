import { createSession, setSessionCookie } from "@/lib/auth";
import { ApiError, jsonError, jsonOk } from "@/lib/api";
import { signupUser } from "@/lib/data";
import { signupSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = signupSchema.parse(await request.json());
    const user = signupUser(body);
    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);
    return jsonOk({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError(new ApiError("Invalid JSON payload.", 400));
    }
    return jsonError(error);
  }
}
