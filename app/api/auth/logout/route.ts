import { NextResponse } from "next/server";

import { deleteSessionByToken, getSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  try {
    const token = await getSessionToken();
    if (token) {
      await deleteSessionByToken(token);
    }
    
    const response = NextResponse.json({ ok: true });
    response.cookies.set("gansys_session", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(0),
      maxAge: 0,
    });
    
    return response;
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
