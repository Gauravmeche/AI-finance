"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SourceAdminControls({ sourceId, isActive, priority }: { sourceId: string; isActive: boolean; priority: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [prio, setPrio] = useState(String(priority));

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={prio}
        onChange={(e) => setPrio(e.target.value)}
        onBlur={() => Number(prio) !== priority && patch({ priority: Number(prio) })}
        title="Priority (lower = higher authority)"
        className="num w-16 bg-background border border-edge rounded px-2 py-1 text-[12px] focus:border-accent outline-none"
      />
      <button
        disabled={busy}
        onClick={() => patch({ isActive: !isActive })}
        className={`border rounded px-2.5 py-1 text-[12px] disabled:opacity-50 ${
          isActive ? "border-danger/40 text-danger hover:bg-danger/10" : "border-ok/40 text-ok hover:bg-ok/10"
        }`}
      >
        {isActive ? "Disable" : "Enable"}
      </button>
    </div>
  );
}
