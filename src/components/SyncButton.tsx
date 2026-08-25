"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ProgressStep {
  source: string;
  status: "pending" | "running" | "ok" | "failed" | "unavailable";
  message?: string;
}
interface SyncStatus {
  running: boolean;
  latest: {
    id: string;
    status: string;
    progress?: { steps: ProgressStep[]; phase: string; iposProcessed: number; eventsUpdated: number; newIpos: number; discrepancies: number } | null;
  } | null;
}

const STEP_ICON: Record<ProgressStep["status"], string> = {
  pending: "○",
  running: "◌",
  ok: "✓",
  failed: "✗",
  unavailable: "⊘",
};
const STEP_CLS: Record<ProgressStep["status"], string> = {
  pending: "text-muted",
  running: "text-accent animate-pulse",
  ok: "text-ok",
  failed: "text-danger",
  unavailable: "text-warn",
};

export function SyncButton({ canSync }: { canSync: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const res = await fetch("/api/sync/status", { cache: "no-store" });
    if (!res.ok) return;
    const data: SyncStatus = await res.json();
    setStatus(data);
    if (wasRunning.current && !data.running) {
      // Sync finished: refresh server-rendered data once, then stop polling.
      wasRunning.current = false;
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
      router.refresh();
    } else if (data.running) {
      wasRunning.current = true;
    }
  }, [router]);

  useEffect(() => {
    poll();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [poll]);

  const startPolling = useCallback(() => {
    if (!timer.current) timer.current = setInterval(poll, 1500);
  }, [poll]);

  async function trigger() {
    setError(null);
    setShowPanel(true);
    const res = await fetch("/api/sync", { method: "POST" });
    if (res.ok || res.status === 409) {
      wasRunning.current = true;
      startPolling();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Sync failed to start (HTTP ${res.status})`);
    }
  }

  const running = status?.running ?? false;
  const progress = status?.latest?.progress;

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          onClick={trigger}
          disabled={!canSync || running}
          title={canSync ? "Fetch, cross-check and verify from all active sources" : "Requires Admin role"}
          className="inline-flex items-center gap-2 bg-accent/15 border border-accent/50 text-accent rounded px-4 py-2 text-sm font-medium hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className={running ? "inline-block animate-spin" : ""}>↻</span>
          {running ? "Syncing…" : "Sync Now"}
        </button>
        {(progress || error) && (
          <button onClick={() => setShowPanel((v) => !v)} className="text-[12px] text-muted hover:text-foreground underline underline-offset-2">
            {showPanel ? "hide progress" : "show progress"}
          </button>
        )}
      </div>

      {showPanel && (error || progress) && (
        <div className="absolute right-0 mt-2 w-80 bg-surface border border-edge rounded-lg shadow-xl p-4 z-50 text-[13px]">
          {error && <p className="text-danger mb-2">{error}</p>}
          {progress && (
            <>
              <p className="text-muted text-[11px] uppercase tracking-wider mb-2">
                {running ? `Syncing — ${progress.phase}` : "Last sync"}
              </p>
              <ul className="space-y-1 mb-3">
                {progress.steps.map((s) => (
                  <li key={s.source} className="flex items-start gap-2">
                    <span className={`num ${STEP_CLS[s.status]}`}>{STEP_ICON[s.status]}</span>
                    <span className="flex-1">
                      {s.source}
                      {s.message && <span className="block text-[11px] text-muted">{s.message}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="num text-[12px] text-muted space-y-0.5">
                <p>{progress.iposProcessed} IPOs processed</p>
                <p>{progress.eventsUpdated} lock-in events updated</p>
                <p>{progress.newIpos} new IPOs found</p>
                <p className={progress.discrepancies ? "text-alert" : ""}>{progress.discrepancies} discrepancies detected</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
