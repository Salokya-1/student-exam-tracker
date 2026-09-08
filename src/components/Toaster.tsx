"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; text: string; kind: "ok" | "error" | "info" };
const EVENT = "rte-toast";

export function toast(text: string, kind: Toast["kind"] = "info") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, kind } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; kind: Toast["kind"] }>).detail;
      const id = Date.now() + Math.random();
      setItems((t) => [...t, { id, ...d }]);
      setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), d.kind === "error" ? 9000 : 6000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!items.length) return null;
  return (
    <div className="fixed z-[60] top-4 right-4 sm:right-6 w-[min(420px,calc(100vw-2rem))] space-y-2 no-print" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`card px-4 py-3 text-[13px] text-ink border-l-4 shadow-[0_8px_24px_rgba(0,0,0,0.45)] ${t.kind === "error" ? "border-l-danger" : t.kind === "ok" ? "border-l-success" : "border-l-info"}`}>
          <div className="flex items-start gap-3">
            <span className="flex-1">{t.text}</span>
            <button type="button" className="text-muted hover:text-ink" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss">
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
