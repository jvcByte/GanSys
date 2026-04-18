import { createSession, setSessionCookie } from "@/lib/auth";
import { handleRoute, parseJson } from "@/lib/api";
import { loginUser } from "@/lib/data";
import { loginSchema } from "@/lib/validators";

export const runtime = "nodejs";

export const POST = handleRoute(async (request: Request) => {
  const body = await parseJson(request, loginSchema);
  const user = await loginUser(body);
  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt);
  return { user };
});
