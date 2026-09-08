"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChatIcon, ChatPanel } from "./ChatPanel";

/** Floating assistant button (bottom-right) available on every page. */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => {
    try {
      setOpen(sessionStorage.getItem("rte-chat-open") === "1");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem("rte-chat-open", open ? "1" : "0");
    } catch {}
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (path?.startsWith("/assistant") || path?.includes("/print")) return null;

  return (
    <div className="no-print">
      {open && (
        <div className="fixed z-50 bottom-20 right-4 sm:right-6 w-[min(420px,calc(100vw-2rem))] h-[min(620px,calc(100vh-7rem))] card shadow-[0_12px_40px_rgba(0,0,0,0.55)] flex flex-col">
          <ChatPanel compact onClose={() => setOpen(false)} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        title="RTE Assistant (Ctrl+K)"
        className={`fixed z-50 bottom-4 right-4 sm:bottom-6 sm:right-6 h-12 px-4 inline-flex items-center gap-2 text-white text-[12px] font-bold tracking-[1.2px] uppercase transition-colors ${open ? "bg-elevated-3 hover:bg-elevated-2" : "bg-rosso hover:bg-rosso-active"}`}
      >
        <ChatIcon size={16} /> {open ? "Close" : "Assistant"}
      </button>
    </div>
  );
}
