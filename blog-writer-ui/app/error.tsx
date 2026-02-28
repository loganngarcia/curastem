"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "Inter, system-ui, sans-serif",
        background: "hsl(0, 0%, 98%)",
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 500, color: "hsl(0, 0%, 20%)", marginBottom: 12 }}>
        Something went wrong
      </h1>
      <p style={{ fontSize: 14, color: "hsl(0, 0%, 45%)", marginBottom: 24, textAlign: "center", maxWidth: 400 }}>
        {error.message || "A client-side exception occurred. Check the browser console for details."}
      </p>
      <button
        onClick={reset}
        style={{
          padding: "10px 20px",
          background: "hsl(142, 71%, 45%)",
          color: "white",
          border: "none",
          borderRadius: 28,
          fontSize: 14,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
      <a
        href="/chat"
        style={{
          marginTop: 16,
          fontSize: 14,
          color: "hsl(142, 71%, 45%)",
          textDecoration: "none",
        }}
      >
        Return to chat
      </a>
    </div>
  );
}
