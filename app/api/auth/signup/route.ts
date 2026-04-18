import { NextResponse } from "next/server";

import { createSession } from "@/lib/auth";
import { parseJson } from "@/lib/api";
import { signupUser } from "@/lib/data";
import { signupSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseJson(request, signupSchema);
    const user = await signupUser(body);
    const session = await createSession(user.id);
    
    const response = NextResponse.json({ user }, { status: 201 });
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
