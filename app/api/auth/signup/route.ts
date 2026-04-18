import { createSession, setSessionCookie } from "@/lib/auth";
import { handleRoute, jsonOk, parseJson } from "@/lib/api";
import { signupUser } from "@/lib/data";
import { signupSchema } from "@/lib/validators";

export const runtime = "nodejs";

export const POST = handleRoute(async (request: Request) => {
  const body = await parseJson(request, signupSchema);
  const user = await signupUser(body);
  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt);
  return jsonOk({ user }, { status: 201 });
});
