// Grafico mensile scritto a mano: barre per il periodo corrente, linea per il
// confronto (es. 2026 contro 2025). Nessuna libreria di grafici (§2.2).
import { formatEuro, type MonthPoint } from "./compute";

export function MonthlyChart({ title, points, column, compareColumn }: { title: string; points: MonthPoint[]; column: string; compareColumn?: string }) {
  const width = 360, height = 170, pad = 12, base = height - 22;
  const values = points.map((p) => p.value);
  const compare = compareColumn ? points.map((p) => p.compare ?? 0) : [];
  const top = Math.max(1, ...values, ...compare);
  const slot = (width - pad * 2) / points.length;
  const bar = Math.max(4, slot * 0.56);
  const line = compare.map((c, i) => [pad + i * slot + slot / 2, base - (Math.max(c, 0) / top) * (base - pad)]);
  return (
    <figure className="grid gap-2" data-testid="agent-chart">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold">{title}</span>
        <span className="flex gap-3 text-xs text-(--mk-muted)">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-(--mk-primary)" />{column}</span>
          {compareColumn && <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-(--mk-text)" />{compareColumn}</span>}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${formatEuro(p.value)}`).join(", ")}`} className="w-full">
        <line x1={pad} x2={width - pad} y1={base} y2={base} stroke="var(--mk-divider)" />
        {points.map((p, i) => {
          const h = (p.value / top) * (base - pad);
          const x = pad + i * slot + (slot - bar) / 2;
          return (
            <g key={p.month}>
              <rect x={x} y={base - h} width={bar} height={Math.max(h, 1)} rx={2} fill="var(--mk-primary)">
                <title>{`${p.label}: ${formatEuro(p.value)}${compareColumn ? ` · ${compareColumn} ${formatEuro(p.compare ?? 0)}` : ""}`}</title>
              </rect>
              <text x={pad + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--mk-muted)">{p.label.split(" ")[0]}</text>
            </g>
          );
        })}
        {line.length > 1 && (
          <>
            <polyline points={line.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="var(--mk-text)" strokeWidth={2} strokeLinejoin="round" />
            {line.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill="var(--mk-surface)" stroke="var(--mk-text)" strokeWidth={1.5} />)}
          </>
        )}
      </svg>
    </figure>
  );
}
