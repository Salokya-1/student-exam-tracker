import Link from "next/link";
import { DAY_NAMES, TEACHING_DAYS, minToTime } from "@/lib/constants";
import type { SessionLite } from "@/lib/engine/clash";

type S = SessionLite & { moduleName?: string; endMin?: number };

const TYPE_TONE: Record<string, string> = {
  LECTURE: "border-info",
  TUTORIAL: "border-success",
  LAB: "border-warn",
};

/**
 * Read-only weekly grid. `mode` decides what to emphasise in each chip.
 * `clashIds` highlights conflicting sessions in Rosso Corsa.
 */
export function WeekGrid({
  sessions,
  mode = "cohort",
  clashIds = new Set<string>(),
  hours = { from: 7, to: 17 },
  linkBase,
}: {
  sessions: S[];
  mode?: "cohort" | "lecturer" | "room" | "all";
  clashIds?: Set<string>;
  hours?: { from: number; to: number };
  linkBase?: string;
}) {
  const rows: number[] = [];
  for (let h = hours.from; h < hours.to; h++) rows.push(h);
  const cell = (day: number, hour: number) => sessions.filter((s) => s.day === day && s.startMin === hour * 60);

  return (
    <div className="scroll-x">
      <div className="min-w-[900px] grid" style={{ gridTemplateColumns: `64px repeat(${TEACHING_DAYS.length}, minmax(0, 1fr))` }}>
        <div className="grid-cell bg-elevated-2" />
        {TEACHING_DAYS.map((d) => (
          <div key={d} className="grid-cell bg-elevated-2 flex items-center justify-center caps text-ink">
            {DAY_NAMES[d]}
          </div>
        ))}
        {rows.map((h) => (
          <RowFragment key={h} h={h} cell={cell} mode={mode} clashIds={clashIds} linkBase={linkBase} />
        ))}
      </div>
    </div>
  );
}

function RowFragment({ h, cell, mode, clashIds, linkBase }: { h: number; cell: (d: number, h: number) => S[]; mode: string; clashIds: Set<string>; linkBase?: string }) {
  return (
    <>
      <div className="grid-cell flex items-start justify-center pt-2 text-[11px] text-muted num">{minToTime(h * 60)}</div>
      {TEACHING_DAYS.map((d) => {
        const items = cell(d, h);
        return (
          <div key={d} className={`grid-cell p-1 space-y-1 ${items.length > 1 && mode !== "all" ? "bg-[rgba(218,41,28,0.08)]" : ""}`}>
            {items.map((s) => {
              const clash = clashIds.has(s.id);
              const chip = (
                <div
                  className={`border-l-2 px-2 py-1 text-[11px] leading-tight ${clash ? "bg-[rgba(218,41,28,0.18)] border-rosso" : `bg-elevated-2 ${TYPE_TONE[s.sessionType] ?? "border-muted"}`}`}
                  title={`${s.moduleCode} ${s.moduleName ?? ""} · ${s.cohortCode} · ${s.lecturerName} · ${s.roomCode} · ${s.sessionType}`}
                >
                  <div className="text-ink font-medium truncate">
                    {s.moduleCode} <span className="text-muted font-normal">{s.sessionType.slice(0, 3)}</span>
                  </div>
                  <div className="truncate text-body">
                    {mode === "cohort" && `${s.roomCode} · ${s.lecturerName.split(" ").slice(-1)[0]}`}
                    {mode === "lecturer" && `${s.cohortCode} · ${s.roomCode}`}
                    {mode === "room" && `${s.cohortCode} · ${s.lecturerName.split(" ").slice(-1)[0]}`}
                    {mode === "all" && `${s.cohortCode} · ${s.roomCode}`}
                  </div>
                </div>
              );
              return linkBase ? (
                <Link key={s.id} href={`${linkBase}${s.id}`} className="block hover:opacity-80">
                  {chip}
                </Link>
              ) : (
                <div key={s.id}>{chip}</div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
