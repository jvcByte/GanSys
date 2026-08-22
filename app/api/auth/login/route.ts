import { NextResponse } from "next/server";

import { createSession } from "@/lib/auth";
import { parseJson } from "@/lib/api";
import { loginUser } from "@/lib/data";
import { loginSchema } from "@/lib/validators";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!rateLimit(`login:${clientIp(request)}`, 10, 60_000)) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }
    const body = await parseJson(request, loginSchema);
    const user = await loginUser(body);
    const session = await createSession(user.id);
    
    const response = NextResponse.json({ user });
    response.cookies.set("gansys_session", session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(session.expiresAt),
    });
    
    return response;
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
