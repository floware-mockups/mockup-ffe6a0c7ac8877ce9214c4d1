// Funzioni pure dell'agente (docs/mockup-ai-agent.md §2: «il modello sceglie,
// spiega e scrive; i numeri li calcola il codice»). Soglie, somme,
// scostamenti e KPI sono deterministici e non dipendono dal modello.
// Le regole comuni con il gateway (numeri, mesi, formule dei KPI) vengono dal
// contratto (contract.ts = shared/mockupAgent.ts); qui ci sono i calcoli che
// girano solo nel browser: soglie, rotazione, confronti, anomalie, risposte.
// Nessuna rete, nessun DOM, nessuno stato.
import { computeAgentFormula, parseAgentNumber, type AgentFormula } from "./contract.ts";

export type AgentTable = { columns: string[]; rows: string[][] };
export type AgentFormulaInput = {
  op: string;
  column: string;
  compareColumn?: string;
  dateColumn?: string;
  threshold?: number;
};

const monthNames = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const monthWords = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

/**
 * «38.500 €», «€ 38.500», «250.000 euro», «EUR 38.500,00», «1.234,5», «12%»,
 * «−8,2 %» → numero; null se non è un numero. È il parser del contratto
 * (`parseAgentNumber`), lo stesso di KPI, confronti, grafici ed Excel.
 */
export function parseNumber(text: unknown): number | null {
  return typeof text === "number" || typeof text === "string" ? parseAgentNumber(text) : null;
}

/** Testo confrontabile: minuscole, senza accenti, spazi compattati. */
export const plainKey = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/** Solo link al testo su Normattiva: https e host esatto www.normattiva.it. */
export function isNormattivaUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "www.normattiva.it" && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

const grouped = (n: number, digits: number) => {
  const fixed = Math.abs(n).toFixed(digits);
  const [int, dec] = fixed.split(".");
  const body = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 && Number(fixed) !== 0 ? "-" : "") + body + (dec ? "," + dec : "");
};
export const formatNumber = (n: number, digits = 0) => grouped(n, digits);
export const formatEuro = (n: number) => grouped(n, Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2) + " €";
export const formatPct = (ratio: number, digits = 1) => grouped(ratio * 100, digits) + "%";
export const formatSignedPct = (ratio: number, digits = 1) => (ratio > 0 ? "+" : "") + formatPct(ratio, digits);
export function formatValue(value: number | null, unit: "€" | "%" | "n"): string {
  if (value === null) return "—";
  if (unit === "€") return formatEuro(value);
  if (unit === "%") return formatPct(value);
  return formatNumber(value, Number.isInteger(value) ? 0 : 1);
}

/** Indice di colonna per nome, senza distinzione di maiuscole, spazi o accenti finali. -1 se assente. */
export function columnIndex(columns: string[], name: string | undefined): number {
  if (!name) return -1;
  const key = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const wanted = key(name);
  const exact = columns.findIndex((c) => key(c) === wanted);
  return exact >= 0 ? exact : columns.findIndex((c) => key(c).startsWith(wanted));
}

const columnWords = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
const moneyColumn = /import|accert|riscoss|incass|versat|pagat|total|€|euro|valore|spesa|atteso|dovut|previst/i;
/** Colonna numerica con più del 70% di celle leggibili come numero (escluse le colonne di numeri di riga). */
export function isNumberColumn(table: AgentTable, i: number): boolean {
  const cells = table.rows.map((r) => (r[i] ?? "").trim()).filter(Boolean);
  if (!cells.length || /^(n|num|numero|n\.|nr|id|codice|progr\w*)\.?$/i.test(table.columns[i].trim())) return false;
  return cells.filter((c) => parseNumber(c) !== null).length / cells.length >= 0.7;
}
/**
 * Nome della colonna della tabella in uso che corrisponde a `name`, anche se il
 * manifesto la chiama come nella tabella di esempio («Importo rilevato» →
 * «Importo», «Esito» → «Stato»): nome esatto o iniziale, poi una parola in comune
 * (con il tipo giusto), poi l'unica colonna del tipo richiesto. `undefined` se non c'è.
 */
export function matchColumn(table: AgentTable, name: string | undefined, kind?: "number" | "date" | "status"): string | undefined {
  if (!name?.trim()) return undefined;
  const fits = (i: number) => kind === "number" ? isNumberColumn(table, i) : kind === "date" ? table.rows.some((r) => monthKey(r[i]) !== null || parseDate(r[i]) !== null) : true;
  // Una colonna con quel nome esatto resta quella, anche se il tipo non torna: il KPI incoerente lo scarta agentKpiIssue.
  const key = plainKey(name);
  const exact = table.columns.findIndex((c) => plainKey(c) === key);
  if (exact >= 0) return table.columns[exact];
  const direct = columnIndex(table.columns, name);
  if (direct >= 0 && fits(direct)) return table.columns[direct];
  const reverse = table.columns.findIndex((c, i) => plainKey(c).length >= 4 && key.startsWith(plainKey(c)) && fits(i));
  if (reverse >= 0) return table.columns[reverse];
  const words = columnWords(name);
  const shared = table.columns.findIndex((c, i) => columnWords(c).some((w) => words.includes(w)) && fits(i));
  if (shared >= 0) return table.columns[shared];
  if (kind === "number") {
    const numeric = table.columns.map((_, i) => i).filter((i) => isNumberColumn(table, i));
    const money = numeric.filter((i) => moneyColumn.test(table.columns[i]));
    const only = money.length === 1 ? money[0] : numeric.length === 1 ? numeric[0] : -1;
    return only >= 0 && (moneyColumn.test(name) || numeric.length === 1) ? table.columns[only] : undefined;
  }
  if (kind === "date") {
    const dates = table.columns.map((_, i) => i).filter((i) => /data|mese|periodo|scadenz|month|date/i.test(table.columns[i]) && fits(i));
    return dates.length >= 1 ? table.columns[dates[0]] : undefined;
  }
  if (kind === "status") {
    const named = table.columns.findIndex((c) => /^(stato|esito|status)\b/i.test(c.trim()));
    return named >= 0 ? table.columns[named] : undefined;
  }
  return undefined;
}

export function numbersOf(table: AgentTable, column: string | undefined): number[] {
  const i = columnIndex(table.columns, column);
  if (i < 0) return [];
  return table.rows.map((r) => parseNumber(r[i])).filter((n): n is number => n !== null);
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Mese di una cella: «2026-03», «03/2026», «15/03/2026», «mar 2026», «marzo».
 * Un mese senza anno prende `contextYear`; senza, la chiave è «0000-mm» e va in fondo.
 */
export function monthKey(text: unknown, contextYear?: string): string | null {
  if (typeof text !== "string") return null;
  const s = text.trim().toLowerCase();
  let m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}`;
  m = /^(?:(\d{1,2})[/.-])?(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[3]}-${m[2].padStart(2, "0")}`;
  m = /^([a-zà]+)\.?\s*(\d{4})?$/.exec(s);
  if (m) {
    const word = m[1];
    const index = monthWords.findIndex((w) => w === word || (word.length >= 3 && w.startsWith(word)));
    const year = m[2] ?? (typeof contextYear === "string" && /^\d{4}$/.test(contextYear) ? contextYear : "0000");
    if (index >= 0) return `${year}-${String(index + 1).padStart(2, "0")}`;
  }
  return null;
}
export function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const name = monthNames[Number(month) - 1] ?? month;
  return year === "0000" ? name : `${name} ${year}`;
}
/** Anno più frequente tra le celle con anno: serve ai mesi scritti senza anno. */
function contextYearOf(cells: string[]): string | undefined {
  const count = new Map<string, number>();
  for (const cell of cells) {
    const key = monthKey(cell);
    if (key && !key.startsWith("0000")) count.set(key.slice(0, 4), (count.get(key.slice(0, 4)) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}
/** Ordine dei mesi: i mesi senza anno («0000-mm») in fondo. */
const byMonth = (a: string, b: string) => Number(a.startsWith("0000")) - Number(b.startsWith("0000")) || a.localeCompare(b);

export type MonthPoint = { month: string; label: string; value: number; compare?: number };
/** Somma di `column` (e, se data, di `compareColumn`) per mese di `dateColumn`, in ordine. */
export function groupByMonth(table: AgentTable, dateColumn: string, column: string, compareColumn?: string): MonthPoint[] {
  const d = columnIndex(table.columns, dateColumn), v = columnIndex(table.columns, column);
  const c = columnIndex(table.columns, compareColumn);
  if (d < 0 || v < 0) return [];
  const map = new Map<string, MonthPoint>();
  const year = contextYearOf(table.rows.map((r) => r[d] ?? ""));
  for (const row of table.rows) {
    const key = monthKey(row[d], year);
    const value = parseNumber(row[v]);
    if (!key || value === null) continue;
    const point = map.get(key) ?? { month: key, label: monthLabel(key), value: 0, ...(c >= 0 ? { compare: 0 } : {}) };
    point.value += value;
    if (c >= 0) point.compare = (point.compare ?? 0) + (parseNumber(row[c]) ?? 0);
    map.set(key, point);
  }
  return [...map.values()].sort((a, b) => byMonth(a.month, b.month));
}

const nextMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
/** Mesi assenti tra il primo e l'ultimo della serie (solo mesi con anno). */
export function missingMonths(points: MonthPoint[]): string[] {
  const keys = points.map((p) => p.month).filter((k) => !k.startsWith("0000"));
  if (keys.length < 2) return [];
  const present = new Set(keys), out: string[] = [];
  for (let k = nextMonth(keys[0]); k < keys[keys.length - 1] && out.length < 24; k = nextMonth(k)) if (!present.has(k)) out.push(k);
  return out;
}

/** Ultimo mese contro il mese precedente presente nei dati; segnala i mesi mancanti. */
export function monthOverMonth(points: MonthPoint[]): { month: string; previous: string; delta: number; missing: string[]; text: string } | null {
  const dated = points.filter((p) => !p.month.startsWith("0000"));
  const series = dated.length >= 2 ? dated : points;
  if (series.length < 2) return null;
  const [prev, last] = series.slice(-2);
  if (!prev.value) return null;
  const delta = last.value / prev.value - 1;
  const missing = missingMonths(series);
  const gap = !prev.month.startsWith("0000") && nextMonth(prev.month) !== last.month;
  const note = missing.length
    ? ` · mancano nei dati: ${missing.map(monthLabel).join(", ")}${gap ? ` (${monthLabel(prev.month)} non è il mese precedente)` : ""}`
    : "";
  return { month: last.month, previous: prev.month, delta, missing, text: `${last.label}: ${formatSignedPct(delta)} rispetto a ${prev.label} (${formatEuro(last.value)} contro ${formatEuro(prev.value)})${note}` };
}

/** Valore di una formula chiusa del manifesto; null se le colonne non ci sono. */
export function evaluateFormula(table: AgentTable, f: AgentFormulaInput): number | null {
  const values = numbersOf(table, f.column);
  const col = columnIndex(table.columns, f.column);
  if (col < 0) return null;
  switch (f.op) {
    case "sum":
      return sum(values);
    case "avg":
      return values.length ? sum(values) / values.length : null;
    case "count":
      return table.rows.filter((r) => (r[col] ?? "").trim() !== "").length;
    case "ratio":
    case "delta_pct": {
      const other = sum(numbersOf(table, f.compareColumn));
      if (columnIndex(table.columns, f.compareColumn) < 0 || other === 0) return null;
      return f.op === "ratio" ? sum(values) / other : sum(values) / other - 1;
    }
    case "group_by_month": {
      const months = groupByMonth(table, f.dateColumn ?? "", f.column);
      return months.length ? months[months.length - 1].value : null;
    }
    case "threshold": {
      if (typeof f.threshold !== "number" || !values.length) return null;
      return values.filter((v) => v < (f.threshold as number)).length / values.length;
    }
    case "distinct_pct": {
      const cells = table.rows.map((r) => (r[col] ?? "").trim().toLowerCase()).filter(Boolean);
      return cells.length ? new Set(cells).size / cells.length : null;
    }
    default:
      return null;
  }
}

/**
 * Valore di un KPI del manifesto con la formula del contratto (la stessa del
 * gateway). delta_pct diventa un rapporto (0,019 = +1,9%); group_by_month dà
 * l'ultimo mese; threshold la quota delle righe che passano. null se mancano colonne.
 */
export function kpiValue(formula: AgentFormula, table: AgentTable): number | null {
  try {
    const r = computeAgentFormula(formula, table);
    if (r.kind === "series") return r.points.length ? r.points[r.points.length - 1].value : null;
    if (r.kind === "threshold") return r.total ? r.passed / r.total : null;
    if (r.value === null) return null;
    return formula.op === "delta_pct" ? r.value / 100 : r.value;
  } catch {
    return null;
  }
}

// ---- Soglie e rotazione (caso «Determinazioni di affidamento diretto») ----

export type ThresholdFact = { key: string; label: string; value: string };
export type ThresholdCategory = "lavori" | "servizi" | "forniture";
export type ThresholdResult = {
  allowed: boolean;
  amount: number;
  threshold: number;
  category: string;
  factLabel: string;
  /** Citazione della voce da cui viene la soglia (es. «D.Lgs. 31 marzo 2023, n. 36, art. 50»). */
  citation?: string;
  text: string;
};
export type ThresholdCheck = { ok: true; result: ThresholdResult } | { ok: false; reason: "amount" | "category" | "threshold"; message: string };
export const thresholdMessages = {
  amount: "Importo non riconosciuto: scrivilo come 38.500 €",
  category: (raw: string) => `Categoria${raw.trim() ? ` «${raw.trim()}»` : ""} senza soglia: scegli lavori, servizi o forniture`,
  threshold: (category: string) => `La norma citata non riporta la soglia per ${category}: verifica il testo vigente su Normattiva`,
} as const;

/** «lavori pubblici» → lavori, «servizio di pulizia» → servizi, «fornitura» → forniture; null se sconosciuta o ambigua. */
export function normalizeCategory(text: unknown): ThresholdCategory | null {
  if (typeof text !== "string") return null;
  const s = plainKey(text);
  const found = new Set([...s.matchAll(/\b(lavor|serviz|fornit)/g)].map((m) => m[1]));
  // «servizi e forniture» hanno la stessa soglia; con «lavori» insieme è ambiguo.
  if (found.has("lavor")) return found.size === 1 ? "lavori" : null;
  if (found.has("serviz")) return "servizi";
  if (found.has("fornit")) return "forniture";
  return null;
}

/**
 * Verifica l'importo contro la soglia della voce citata. La soglia viene dai
 * `facts` della citazione (mai dal modello): `factKey` esplicito oppure la
 * soglia della categoria normalizzata. Nessun ripiego: importo illeggibile,
 * categoria sconosciuta o soglia assente danno un errore esplicito.
 */
export function checkThreshold(input: { amount: unknown; category?: string; factKey?: string; facts: ThresholdFact[]; citation?: string }): ThresholdCheck {
  const amount = parseNumber(input.amount);
  if (amount === null || amount <= 0) return { ok: false, reason: "amount", message: thresholdMessages.amount };
  const numeric = input.facts.filter((f) => parseNumber(f.value) !== null);
  const byKey = input.factKey ? numeric.find((f) => f.key === input.factKey) : undefined;
  const category = normalizeCategory(input.category);
  if (!byKey && !category) return { ok: false, reason: "category", message: thresholdMessages.category(input.category ?? "") };
  const short = category === "lavori" ? "lavori" : category ? "servizi e forniture" : "la voce indicata";
  const text = (f: ThresholdFact) => plainKey(`${f.key} ${f.label}`);
  const fact =
    byKey ??
    numeric.find((f) => (category === "lavori" ? /lavor/.test(text(f)) : /serviz|fornit/.test(text(f)) && !/lavor/.test(text(f))));
  if (!fact) return { ok: false, reason: "threshold", message: thresholdMessages.threshold(short) };
  const threshold = parseNumber(fact.value) as number;
  const allowed = amount < threshold;
  return {
    ok: true,
    result: {
      allowed,
      amount,
      threshold,
      category: short,
      factLabel: fact.label,
      ...(input.citation ? { citation: input.citation } : {}),
      text: `${formatEuro(amount)} ${allowed ? "<" : "≥"} ${formatEuro(threshold)} (${short}): ${allowed ? "sotto soglia, affidamento diretto ammesso" : "sopra soglia, serve una procedura diversa dall'affidamento diretto"}${input.citation ? ` (${input.citation})` : ""}`,
    },
  };
}

/** «15/03/2026» o «2026-03-15» → millisecondi UTC; null se non è una data. */
export function parseDate(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const s = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}
export const formatDate = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

/**
 * Nome dell'operatore confrontabile: minuscole, senza accenti né punteggiatura,
 * spazi compattati; «S.r.l.», «s.r.l», «SRL» → «srl» (così «spa», «snc», «sas»).
 */
export function operatorKey(name: string): string {
  const tokens = plainKey(name).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let run = false;
  // Lettere singole consecutive («s r l», «s p a») diventano una sigla («srl», «spa»).
  for (const t of tokens) {
    if (t.length === 1 && run) out[out.length - 1] += t;
    else out.push(t);
    run = t.length === 1;
  }
  return out.join(" ");
}

export type RotationResult = { respected: boolean; matches: number; last: number | null; months: number; operator: string; text: string };
/**
 * Verifica indicativa sul principio di rotazione (art. 49 del D.Lgs. 36/2023):
 * affidamenti allo stesso operatore nell'archivio caricato, negli ultimi
 * `months` mesi da `today`. La finestra è quella del controllo, non una regola
 * di legge: l'art. 49 c. 2 riguarda il contraente uscente e due affidamenti
 * consecutivi nello stesso settore merceologico, che il testo invita a verificare.
 */
export function checkRotation(table: AgentTable, input: { operator: string; operatorColumn: string; dateColumn: string; months: number; today: number }): RotationResult | null {
  const o = columnIndex(table.columns, input.operatorColumn), d = columnIndex(table.columns, input.dateColumn);
  const name = operatorKey(input.operator);
  if (o < 0 || d < 0 || !name) return null;
  const from = new Date(input.today);
  from.setUTCMonth(from.getUTCMonth() - input.months);
  const dates = table.rows
    .filter((r) => operatorKey(r[o] ?? "") === name)
    .map((r) => parseDate(r[d]))
    .filter((t): t is number => t !== null && t >= from.getTime() && t <= input.today)
    .sort((a, b) => b - a);
  const respected = dates.length === 0;
  const operator = input.operator.trim();
  const found = respected
    ? `nell'archivio caricato non risultano affidamenti a ${operator} nei ${input.months} mesi controllati`
    : `nell'archivio caricato risultano ${dates.length} affidament${dates.length === 1 ? "o" : "i"} a ${operator} nei ${input.months} mesi controllati (l'ultimo il ${formatDate(dates[0])})`;
  return {
    respected,
    matches: dates.length,
    last: dates[0] ?? null,
    months: input.months,
    operator,
    text: `verifica indicativa sul principio di rotazione (art. 49): ${found}; verifica se è il contraente uscente in due affidamenti consecutivi nello stesso settore merceologico${respected ? "" : " e, in quel caso, motiva la deroga"}`,
  };
}

// ---- Confronti e anomalie (caso «Riscossioni») -----------------------------

export type ComparisonRow = { label: string; value: number; compare: number; base: number | null; delta: number | null; capacity: number | null };
/**
 * Riga per riga: `column` contro `compareColumn` (Δ%) e, se data,
 * `column` ÷ `baseColumn` (capacità di riscossione). `labelColumns` compone l'etichetta.
 */
export function compareRows(table: AgentTable, input: { column: string; compareColumn?: string; baseColumn?: string; labelColumns: string[] }): ComparisonRow[] {
  const v = columnIndex(table.columns, input.column);
  const c = columnIndex(table.columns, input.compareColumn);
  const b = columnIndex(table.columns, input.baseColumn);
  const labels = input.labelColumns.map((l) => columnIndex(table.columns, l)).filter((i) => i >= 0);
  if (v < 0) return [];
  return table.rows.flatMap((row) => {
    const value = parseNumber(row[v]);
    if (value === null) return [];
    const compare = c >= 0 ? parseNumber(row[c]) : null;
    const base = b >= 0 ? parseNumber(row[b]) : null;
    return [{
      label: labels.map((i) => row[i]).join(" · ") || row[0],
      value,
      compare: compare ?? 0,
      base,
      delta: compare ? value / compare - 1 : null,
      capacity: base ? value / base : null,
    }];
  });
}

export type Anomaly = { label: string; reason: string; delta: number | null; capacity: number | null };
/** Scostamenti oltre `deltaLimit` (in valore assoluto) o capacità sotto `capacityLimit`. Prima i peggiori. */
export function findAnomalies(rows: ComparisonRow[], deltaLimit = 0.1, capacityLimit = 0.7): Anomaly[] {
  const out: Anomaly[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    // Tolleranza per la virgola mobile: 90/100 − 1 = −0,0999… è un calo del 10%.
    if (r.delta !== null && Math.abs(r.delta) >= deltaLimit - 1e-9) reasons.push(`${formatSignedPct(r.delta)} rispetto al periodo di confronto`);
    if (r.capacity !== null && r.capacity < capacityLimit - 1e-9) reasons.push(`capacità di riscossione ${formatPct(r.capacity)}`);
    if (reasons.length) out.push({ label: r.label, reason: reasons.join(", "), delta: r.delta, capacity: r.capacity });
  }
  return out.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
}

/** Gruppo (es. capitolo) con lo scostamento peggiore sul totale del gruppo. */
export function worstGroup(table: AgentTable, groupColumn: string, column: string, compareColumn: string): { group: string; delta: number } | null {
  const g = columnIndex(table.columns, groupColumn), v = columnIndex(table.columns, column), c = columnIndex(table.columns, compareColumn);
  if (g < 0 || v < 0 || c < 0) return null;
  const totals = new Map<string, [number, number]>();
  for (const row of table.rows) {
    const t = totals.get(row[g]) ?? [0, 0];
    t[0] += parseNumber(row[v]) ?? 0;
    t[1] += parseNumber(row[c]) ?? 0;
    totals.set(row[g], t);
  }
  let worst: { group: string; delta: number } | null = null;
  for (const [group, [a, b]] of totals) {
    if (!b) continue;
    const delta = a / b - 1;
    if (!worst || delta < worst.delta) worst = { group, delta };
  }
  return worst;
}

/** «Normalizzo importi e mesi»: importi in formato italiano, mesi come «mar 2026». Restituisce anche le celle cambiate. */
export function normalizeTable(table: AgentTable): { table: AgentTable; changed: number } {
  let changed = 0;
  const money = table.columns.map((c) => /import|accert|riscoss|incass|total|€|euro|valore|spesa/i.test(c));
  const dates = table.columns.map((c) => /mese|periodo|data|month/i.test(c));
  const years = table.columns.map((_, i) => (dates[i] ? contextYearOf(table.rows.map((r) => r[i] ?? "")) : undefined));
  const rows = table.rows.map((row) =>
    row.map((cell, i) => {
      let next = cell.trim();
      if (dates[i]) {
        // Una data con il giorno («2026-03-15», «15/03/2026») resta com'è: solo i mesi si uniformano.
        const key = parseDate(next) === null ? monthKey(next, years[i]) : null;
        if (key && !key.startsWith("0000")) next = monthLabel(key);
      } else if (money[i]) {
        const n = parseNumber(next);
        if (n !== null) next = formatEuro(n);
      }
      if (next !== cell) changed++;
      return next;
    }),
  );
  return { table: { columns: table.columns.map((c) => c.trim()), rows }, changed };
}

// ---- Modelli, variabili e integrazione con il prototipo --------------------

/** Segnaposto `{{chiave}}` di un modello, in ordine e senza ripetizioni. */
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]))];
}
/** Sostituisce i `{{chiave}}`; i segnaposto senza valore restano leggibili come «[chiave]». */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => (values[key]?.trim() ? values[key].trim() : `[${key}]`));
}
export function resolveInput(input: Record<string, string>, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === "string" ? v.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => values[key] ?? "") : ""]));
}

const normativeTerms = /\b(sogli\w*|affidament\w*|articol\w*|norm[ae]|normativ\w*|codice|d\.?\s?lgs\.?|decret\w*|legge)\b|\bart\.?\s*\d|\bart\./;
/** Colonna nominata nella domanda (parola intera, senza accenti); a parità vince il nome più lungo. */
function namedColumn(question: string, columns: string[]): string | undefined {
  const q = ` ${plainKey(question).replace(/[^a-z0-9%€]+/g, " ")} `;
  return columns
    .map((c) => ({ c, k: plainKey(c).replace(/[^a-z0-9%€]+/g, " ").trim() }))
    .filter(({ k }) => k.length >= 3 && q.includes(` ${k} `))
    .sort((a, b) => b.k.length - a.k.length)[0]?.c;
}

/**
 * Risposte locali e calcolate alle domande sui dati caricati (totale, media,
 * massimo, minimo, gruppo peggiore). Si risponde solo se la domanda nomina una
 * colonna e non tocca la norma (soglie, affidamenti, articoli): altrimenti
 * null e la domanda va al gateway. Il pannello le marca «calcolato sui dati caricati».
 */
export function answerDataQuestion(question: string, table: AgentTable | null): string | null {
  if (!table || !table.rows.length) return null;
  const q = plainKey(question);
  if (normativeTerms.test(q)) return null;
  const money = table.columns.filter((c) => numbersOf(table, c).length === table.rows.length);
  if (!money.length) return null;
  const groups = table.columns.filter((c) => !money.includes(c));
  const value = namedColumn(question, money);
  const groupNamed = namedColumn(question, groups);
  if (!value && !groupNamed) return null;
  if (/peggior|scostament|calo|anomal/.test(q)) {
    const named = value ?? money.find((c) => /riscoss|import|total/i.test(c)) ?? money[0];
    const group = groupNamed ?? groups[0];
    const compare = money.find((c) => c !== named && plainKey(c).startsWith(plainKey(named)) && /20\d\d|preced|confront/i.test(c))
      ?? money.find((c) => c !== named && /20\d\d|preced|confront/i.test(c));
    const worst = compare && group ? worstGroup(table, group, named, compare) : null;
    if (worst) {
      const drop = compareRows(table, { column: named, compareColumn: compare, labelColumns: groups }).filter((r) => r.delta !== null).sort((a, b) => (a.delta as number) - (b.delta as number))[0];
      return `Sul totale, l'andamento peggiore è «${worst.group}»: ${formatSignedPct(worst.delta)} su «${named}» rispetto a «${compare}».${drop && (drop.delta as number) < 0 ? ` Il calo più forte in una singola riga è ${drop.label}: ${formatSignedPct(drop.delta as number)}.` : ""}`;
    }
    return null;
  }
  // Media, massimo, minimo e totale chiedono una colonna di importi nominata.
  if (!value) return null;
  const values = numbersOf(table, value);
  if (/\bmedi[ao]\b/.test(q)) return `La media di «${value}» è ${formatEuro(sum(values) / values.length)} su ${values.length} righe.`;
  const max = /massim|piu alt|maggior/.test(q), min = /minim|piu bass|minor/.test(q);
  if (max !== min) {
    const label = groupNamed ?? groups.find((c) => !/data|mese|periodo/i.test(c)) ?? groups[0];
    const i = columnIndex(table.columns, value), g = columnIndex(table.columns, label);
    const row = [...table.rows].sort((a, b) => ((parseNumber(b[i]) ?? 0) - (parseNumber(a[i]) ?? 0)) * (max ? 1 : -1))[0];
    return `Il valore ${max ? "più alto" : "più basso"} di «${value}» è ${formatEuro(parseNumber(row[i]) ?? 0)}${g >= 0 ? ` (${row[g]})` : ""}.`;
  }
  if (/\b(totale|totali|somma|complessiv\w*)\b/.test(q)) return `Il totale di «${value}» è ${formatEuro(sum(values))} su ${values.length} righe.`;
  return null;
}
