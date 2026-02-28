import { NextRequest, NextResponse } from "next/server";

// Simple in-memory rate limiting for API routes
const rateLimits = new Map<string, { count: number; lastReset: number }>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 20; // 20 requests per minute

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const limit = rateLimits.get(ip);

  if (!limit || now - limit.lastReset > WINDOW_MS) {
    rateLimits.set(ip, { count: 1, lastReset: now });
    return true;
  }

  if (limit.count >= MAX_REQUESTS) {
    return false;
  }

  limit.count++;
  return true;
}

export function handleApiError(error: unknown) {
  console.error("API Error:", error);
  
  if (error instanceof Error) {
    if (error.message.includes("Framer credentials")) {
      return NextResponse.json(
        { error: "CMS connection error. Please check configuration." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { error: "An unexpected error occurred." },
    { status: 500 }
  );
}
