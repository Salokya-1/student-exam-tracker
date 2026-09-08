"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="no-print border border-black px-4 py-2 text-[12px] uppercase tracking-wider">
      Print
    </button>
  );
}
