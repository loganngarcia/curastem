import { SignJWT, jwtVerify, JWTPayload } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const SESSION_COOKIE = "curastem_session";
const JWT_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET
);

export interface Session extends JWTPayload {
  authenticated: boolean;
}

export async function createSession(): Promise<string> {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET environment variable is not set");
  }
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(JWT_SECRET);
  
  return token;
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    if (!process.env.SESSION_SECRET) {
      throw new Error("SESSION_SECRET not set");
    }
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as Session;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 24, // 24 hours
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionFromRequest(
  request: NextRequest
): Promise<Session | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const session = await getSessionFromRequest(request);
  return session?.authenticated === true;
}

export function verifyPassword(password: string): boolean {
  const expectedPassword = process.env.AUTH_PASSWORD?.trim();
  
  if (!expectedPassword) {
    console.error("AUTH_PASSWORD environment variable is not set");
    return false;
  }
  
  const trimmed = password?.trim();
  return trimmed === expectedPassword;
}

export async function requireAuth(request: NextRequest): Promise<{
  authenticated: boolean;
  redirect?: string;
}> {
  const authenticated = await isAuthenticated(request);
  
  if (!authenticated) {
    return {
      authenticated: false,
      redirect: "/login",
    };
  }
  
  return { authenticated: true };
}
