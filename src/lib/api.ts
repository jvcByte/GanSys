import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function jsonOk(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, init);
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
}

export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError("Authentication required.", 401);
  }
  return user;
}
