import { NextRequest, NextResponse } from "next/server";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password, action } = body;

    if (action === "logout") {
      await clearSessionCookie();
      return NextResponse.json({ success: true });
    }

    if (action === "login" || password) {
      if (!verifyPassword(password)) {
        return NextResponse.json(
          { error: "Invalid password" },
          { status: 401 }
        );
      }

      const token = await createSession();
      await setSessionCookie(token);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: "Auth endpoint" });
}
