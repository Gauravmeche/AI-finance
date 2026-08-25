"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push(params.get("next") ?? "/");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Login failed");
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm bg-surface border border-edge rounded-lg p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">India IPO Lock-in Tracker</h1>
        <p className="text-[12px] text-muted mt-1">Source-verified upcoming IPO lock-in expiries</p>
      </div>
      <label className="block space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-muted">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-background border border-edge rounded px-3 py-2 text-sm focus:border-accent outline-none"
          placeholder="analyst@example.com"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-muted">Password</span>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-background border border-edge rounded px-3 py-2 text-sm focus:border-accent outline-none"
        />
      </label>
      {error && <p className="text-danger text-[12px]">{error}</p>}
      <button
        disabled={busy}
        className="w-full bg-accent/15 border border-accent/50 text-accent rounded px-3 py-2 text-sm hover:bg-accent/25 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-[11px] text-muted leading-relaxed">
        Demo accounts: admin@example.com, analyst@example.com, viewer@example.com (see README for passwords).
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
