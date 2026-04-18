import { clearSessionCookie, deleteSessionByToken, getSessionToken } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";

export async function POST() {
  try {
    const token = await getSessionToken();
    if (token) {
      await deleteSessionByToken(token);
      await clearSessionCookie();
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
