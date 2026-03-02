"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/chat";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push(redirect);
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid password");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }} onSubmit={handleSubmit}>
      <label htmlFor="password" className="sr-only">Password</label>
      <input
        id="password"
        name="password"
        data-testid="password-input"
        aria-label="Password"
        type="password"
        autoComplete="current-password"
        required
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{
          width: "100%",
          height: 44,
          borderRadius: 28,
          border: "0.33px solid hsla(0,0%,0%,0.2)",
          padding: "0 18px",
          fontSize: 15,
          fontFamily: "Inter, system-ui, sans-serif",
          color: "#111",
          background: "#fafafa",
          outline: "none",
          boxSizing: "border-box",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "hsl(204,100%,50%)";
          e.currentTarget.style.boxShadow = "0 0 0 3px hsla(204,100%,50%,0.15)";
          e.currentTarget.style.background = "#fff";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "hsla(0,0%,0%,0.2)";
          e.currentTarget.style.boxShadow = "none";
          e.currentTarget.style.background = "#fafafa";
        }}
      />

      {error && (
        <p data-testid="login-error" style={{ fontSize: 13, color: "hsl(0,72%,51%)", margin: "2px 4px 0" }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        data-testid="login-submit"
        disabled={loading}
        style={{
          width: "100%",
          height: 44,
          borderRadius: 28,
          border: "none",
          background: "hsl(204,100%,50%)",
          color: "#fff",
          fontSize: 15,
          fontWeight: 600,
          fontFamily: "Inter, system-ui, sans-serif",
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.6 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "opacity 0.15s, background 0.15s",
        }}
        onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "hsl(204,100%,44%)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "hsl(204,100%,50%)"; }}
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", background: "#f0f0f0", padding: "0 16px" }}>
      <div style={{
        width: "100%",
        maxWidth: 400,
        background: "#fff",
        borderRadius: 48,
        padding: "36px 32px 32px",
      }}>
        <div style={{ textAlign: "left", marginBottom: 28 }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="hsl(204,100%,50%)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ marginBottom: 14, display: "block" }}>
            <rect x="3" y="11" width="18" height="11" rx="5" ry="5"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <h1 style={{ fontSize: 34, fontWeight: 700, color: "#111", fontFamily: "Inter, system-ui, sans-serif", margin: 0, letterSpacing: "-0.5px" }}>
            Curastem Blogs
          </h1>
          <p style={{ fontSize: 16, color: "#888", fontFamily: "Inter, system-ui, sans-serif", marginTop: 8 }}>
            Enter your password to continue
          </p>
        </div>

        <Suspense fallback={
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Loader2 className="animate-spin" />
          </div>
        }>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
