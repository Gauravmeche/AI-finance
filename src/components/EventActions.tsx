"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EventActions({ eventId, canAct }: { eventId: string; canAct: boolean }) {
  const router = useRouter();
  const [showOverride, setShowOverride] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [overrideDate, setOverrideDate] = useState("");
  const [reason, setReason] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [note, setNote] = useState("");

  if (!canAct) return null;

  async function post(url: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg("Saved.");
      setShowOverride(false);
      setShowNote(false);
      router.refresh();
    } else {
      setMsg(data.error ?? `Failed (HTTP ${res.status})`);
    }
  }

  const inputCls = "w-full bg-background border border-edge rounded px-2 py-1.5 text-[13px] focus:border-accent outline-none";

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={() => post(`/api/lock-ins/${eventId}/verify`)}
          className="border border-edge rounded px-2.5 py-1 text-[12px] text-muted hover:text-foreground hover:border-muted disabled:opacity-50"
        >
          ↺ Re-run verification
        </button>
        <button
          onClick={() => { setShowOverride((v) => !v); setShowNote(false); }}
          className="border border-edge rounded px-2.5 py-1 text-[12px] text-muted hover:text-foreground hover:border-muted"
        >
          Override date…
        </button>
        <button
          onClick={() => { setShowNote((v) => !v); setShowOverride(false); }}
          className="border border-edge rounded px-2.5 py-1 text-[12px] text-muted hover:text-foreground hover:border-muted"
        >
          Add note…
        </button>
        {msg && <span className={`text-[12px] self-center ${msg === "Saved." ? "text-ok" : "text-danger"}`}>{msg}</span>}
      </div>

      {showOverride && (
        <div className="border border-manual/40 bg-manual/5 rounded-lg p-3 space-y-2 max-w-md">
          <p className="text-[12px] text-manual">
            Manual override — the underlying scraped data is preserved; the override is recorded with your name and
            timestamp in the audit trail.
          </p>
          <input type="date" value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} className={inputCls} />
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, min 5 chars) — cite what you checked"
            rows={2}
            className={inputCls}
          />
          <input
            value={supportUrl}
            onChange={(e) => setSupportUrl(e.target.value)}
            placeholder="Supporting source URL (optional)"
            className={inputCls}
          />
          <button
            disabled={busy || !overrideDate || reason.length < 5}
            onClick={() => post(`/api/lock-ins/${eventId}/override`, { overrideDate, reason, supportingSourceUrl: supportUrl })}
            className="bg-manual/15 border border-manual/50 text-manual rounded px-3 py-1.5 text-[13px] hover:bg-manual/25 disabled:opacity-50"
          >
            Apply override
          </button>
        </div>
      )}

      {showNote && (
        <div className="border border-edge rounded-lg p-3 space-y-2 max-w-md bg-surface-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note…" rows={2} className={inputCls} />
          <button
            disabled={busy || !note.trim()}
            onClick={() => post(`/api/lock-ins/${eventId}/notes`, { note })}
            className="border border-edge rounded px-3 py-1.5 text-[13px] text-muted hover:text-foreground disabled:opacity-50"
          >
            Save note
          </button>
        </div>
      )}
    </div>
  );
}
