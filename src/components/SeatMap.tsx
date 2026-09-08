export type SeatCell = { row: number; col: number; label: string; seatNo: number; studentNo: string; name: string; cohort: string; paper: string; mine: boolean };

const PALETTE = ["#4c98b9", "#e8a33d", "#39c27c", "#b07cd6", "#e06c9f", "#7cc0dc"];

/** Room seating map: rows × cols grid, coloured per paper. Server-safe (no state). */
export function SeatMap({ rows, cols, seats, highlight }: { rows: number; cols: number; seats: SeatCell[]; highlight?: string }) {
  const papers = [...new Set(seats.map((s) => s.paper))];
  const color = (p: string) => PALETTE[papers.indexOf(p) % PALETTE.length];
  const byPos = new Map(seats.map((s) => [`${s.row}-${s.col}`, s]));
  return (
    <div className="p-4">
      <div className="text-center caps mb-3">Front of room · invigilator desk</div>
      <div className="scroll-x">
        <div className="inline-grid gap-1 mx-auto" style={{ gridTemplateColumns: `28px repeat(${cols}, 34px)` }}>
          <div />
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="text-center text-[10px] text-muted num">
              {c + 1}
            </div>
          ))}
          {Array.from({ length: rows }, (_, r) => (
            <RowCells key={r} r={r + 1} cols={cols} byPos={byPos} color={color} highlight={highlight} />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 mt-4 text-[11px]">
        {papers.map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <i className="inline-block w-3 h-3" style={{ background: color(p) }} /> {p}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-muted">
          <i className="inline-block w-3 h-3 border border-hairline-2" /> empty
        </span>
      </div>
    </div>
  );
}

function RowCells({ r, cols, byPos, color, highlight }: { r: number; cols: number; byPos: Map<string, SeatCell>; color: (p: string) => string; highlight?: string }) {
  return (
    <>
      <div className="text-[10px] text-muted flex items-center justify-center">{String.fromCharCode(64 + r)}</div>
      {Array.from({ length: cols }, (_, c) => {
        const s = byPos.get(`${r}-${c + 1}`);
        if (!s) return <div key={c} className="h-[34px] border border-hairline" />;
        const hl = highlight && s.studentNo === highlight;
        return (
          <div
            key={c}
            title={`${s.label} · ${s.studentNo} ${s.name} · ${s.cohort} · ${s.paper}`}
            className={`h-[34px] flex items-center justify-center text-[9px] font-semibold text-black/80 ${hl ? "ring-2 ring-rosso" : ""} ${s.mine ? "" : "opacity-60"}`}
            style={{ background: color(s.paper) }}
          >
            {s.studentNo.slice(-3)}
          </div>
        );
      })}
    </>
  );
}
