import { clearSessionCookie, deleteSessionByToken, getSessionToken } from "@/lib/auth";
import { handleRoute } from "@/lib/api";

export const runtime = "nodejs";

export const POST = handleRoute(async () => {
  const token = await getSessionToken();
  if (token) {
    await deleteSessionByToken(token);
    await clearSessionCookie();
  }
  return { ok: true };
});
