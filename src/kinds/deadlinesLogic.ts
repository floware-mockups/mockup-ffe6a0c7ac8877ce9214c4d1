// WZ-2126: logica pura del tipo di pagina «Scadenzario a semaforo».
// Copia identica in shared/mockupKinds/deadlinesLogic.ts (anteprima di
// FlowareHub): un test verifica che i due file restino uguali.
// Le date sono giorni di calendario locali «AAAA-MM-GG»: i calcoli usano
// Date.UTC sui tre numeri, così ora legale e fuso orario non spostano i giorni.
// Solo dati in memoria: nessuna rete.

export type DeadlinesConfig = {
  /** Colonna con la data (gg/mm/aaaa, AAAA-MM-GG oppure «+3»/«-2» giorni da oggi). */
  dateColumn: number;
  descriptionColumn: number;
  officeColumn?: number;
  ownerColumn?: number;
  normColumn?: number;
  /** «ogni anno» (o «annuale») crea la scadenza dell'anno dopo alla chiusura. */
  recurrenceColumn?: number;
  /** Data di completamento; vuota o «—» se aperta. */
  completedColumn?: number;
  /** Rosso se mancano meno di questi giorni (predefinito 7). */
  redBelow?: number;
  /** Giallo fino a questi giorni compresi (predefinito 30). */
  yellowUpTo?: number;
};
export const deadlinesColumnFields = [
  "dateColumn",
  "descriptionColumn",
  "officeColumn",
  "ownerColumn",
  "normColumn",
  "recurrenceColumn",
  "completedColumn",
] as const;
export type DeadlinesColumnField = (typeof deadlinesColumnFields)[number];
export const deadlinesRequiredFields: readonly DeadlinesColumnField[] = ["dateColumn", "descriptionColumn"];

export type DeadlineLight = "rosso" | "giallo" | "verde" | "grigio";
export const deadlineLightLabels: Record<DeadlineLight, string> = {
  rosso: "Rossa",
  giallo: "Gialla",
  verde: "Verde",
  grigio: "Completata",
};
export type DeadlineItem = {
  /** Indice della riga nella tabella della pagina. */
  index: number;
  date: string;
  description: string;
  office: string;
  owner: string;
  norm: string;
  yearly: boolean;
  completed: string;
  days: number;
  light: DeadlineLight;
  weekend: boolean;
};
export type DeadlineFilters = { office: string; owner: string; state: "aperte" | "tutte" | "rosse" };
export const emptyDeadlineFilters: DeadlineFilters = { office: "", owner: "", state: "aperte" };

const pad = (n: number) => String(n).padStart(2, "0");
const empty = (cell: string | undefined) => !cell || /^\s*(—|-|–|no|nessuna)?\s*$/i.test(cell);
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const fromDayNumber = (n: number) => {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const validDate = (y: number, m: number, d: number) => {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Oggi nel fuso del browser, come «AAAA-MM-GG». */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
/** Millisecondi fino alla prossima mezzanotte locale (quando «oggi» cambia). */
export function msUntilNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}
/** Aggiunge giorni a una data «AAAA-MM-GG». */
export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}
/** Giorni da `from` a `to` (negativo se `to` è passato). */
export function daysBetween(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from));
}
/** 0 domenica … 6 sabato. */
export function weekday(iso: string): number {
  return new Date(dayNumber(iso) * 86_400_000).getUTCDay();
}
export const isWeekend = (iso: string) => weekday(iso) === 0 || weekday(iso) === 6;
/** Venerdì precedente per sabato e domenica; altrimenti la data stessa. */
export function previousFriday(iso: string): string {
  const day = weekday(iso);
  return day === 6 ? addDays(iso, -1) : day === 0 ? addDays(iso, -2) : iso;
}
const isLeap = (y: number) => validDate(y, 2, 29);
/**
 * Stessa data un anno dopo. Una scadenza del 29 febbraio (`leapDay`) cade il 28
 * negli anni normali e torna al 29 negli anni bisestili.
 */
export function nextYear(iso: string, leapDay = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const day = leapDay && m === 2 ? (isLeap(y + 1) ? 29 : 28) : validDate(y + 1, m, d) ? d : 28;
  return `${y + 1}-${pad(m)}-${pad(day)}`;
}
/** Prossima ricorrenza annuale dopo oggi: una scadenza passata da anni salta agli anni seguenti. */
export function nextOccurrence(iso: string, today: string, leapDay = false): string {
  let next = nextYear(iso, leapDay);
  for (let i = 0; i < 400 && next <= today; i++) next = nextYear(next, leapDay);
  return next;
}
/** Segno nella ricorrenza che ricorda il 29 febbraio di partenza. */
export const leapDayMark = "(29/02)";

/**
 * Legge una data da una cella: «AAAA-MM-GG», «gg/mm/aaaa» (anche con «-» o «.»)
 * oppure giorni relativi a oggi («+3», «-2», «oggi+12»). null se non è una data.
 */
export function parseDeadlineDate(cell: string | undefined, today: string): string | null {
  const text = (cell ?? "").trim().replace(/[−–]/g, "-");
  let m = /^(?:oggi\s*)?([+-]\s*\d{1,4})$/i.exec(text);
  if (m) return addDays(today, Number(m[1].replace(/\s/g, "")));
  if (/^oggi$/i.test(text)) return today;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m && validDate(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m && validDate(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}
/** «gg/mm/aaaa» per l'interfaccia. */
export function formatItalianDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
const months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const monthName = (month: number) => months[month - 1];
const weekdays = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
export const weekdayName = (iso: string) => weekdays[weekday(iso)];

export function deadlineLight(days: number, completed: boolean, config: Pick<DeadlinesConfig, "redBelow" | "yellowUpTo"> = {}): DeadlineLight {
  if (completed) return "grigio";
  const red = config.redBelow ?? 7;
  const yellow = config.yellowUpTo ?? 30;
  if (days < red) return "rosso";
  if (days <= yellow) return "giallo";
  return "verde";
}

const yearlyPattern = /ogni\s+anno|annual|annuale|ogni\s+12\s+mesi/i;
const cellOf = (row: readonly string[], column: number | undefined) =>
  column === undefined || column < 0 ? "" : (row[column] ?? "").trim();

/** Righe della pagina come scadenze; le righe senza data valida sono ignorate. */
export function deadlineItems(rows: readonly (readonly string[])[], config: DeadlinesConfig, today: string): DeadlineItem[] {
  const out: DeadlineItem[] = [];
  rows.forEach((row, index) => {
    const date = parseDeadlineDate(row[config.dateColumn], today);
    if (!date) return;
    const completedCell = cellOf(row, config.completedColumn);
    const completed = empty(completedCell) ? "" : parseDeadlineDate(completedCell, today) ?? completedCell;
    const days = daysBetween(today, date);
    out.push({
      index,
      date,
      description: cellOf(row, config.descriptionColumn),
      office: empty(cellOf(row, config.officeColumn)) ? "" : cellOf(row, config.officeColumn),
      owner: empty(cellOf(row, config.ownerColumn)) ? "" : cellOf(row, config.ownerColumn),
      norm: empty(cellOf(row, config.normColumn)) ? "" : cellOf(row, config.normColumn),
      yearly: yearlyPattern.test(cellOf(row, config.recurrenceColumn)),
      completed,
      days,
      light: deadlineLight(days, completed !== "", config),
      weekend: isWeekend(date),
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
}
/**
 * Le date relative («+3») diventano date vere all'apertura, così restano ferme
 * per tutta la sessione anche se si passa la mezzanotte.
 */
export function resolveDeadlineRows(rows: readonly (readonly string[])[], config: DeadlinesConfig, today: string): string[][] {
  return rows.map((row) =>
    row.map((cell, c) => {
      if (c !== config.dateColumn && c !== config.completedColumn) return cell;
      if (c === config.completedColumn && empty(cell)) return "";
      const date = parseDeadlineDate(cell, today);
      return date ? formatItalianDate(date) : cell;
    }),
  );
}

/** Filtri per ufficio e responsabile (valgono anche per i contatori) e per stato. */
export function filterDeadlines(items: readonly DeadlineItem[], filters: DeadlineFilters) {
  const scoped = items.filter((i) => (!filters.office || i.office === filters.office) && (!filters.owner || i.owner === filters.owner));
  const counts: Record<DeadlineLight, number> = { rosso: 0, giallo: 0, verde: 0, grigio: 0 };
  for (const i of scoped) counts[i.light]++;
  const shown = scoped.filter((i) =>
    filters.state === "tutte" ? true : filters.state === "rosse" ? i.light === "rosso" : i.light !== "grigio",
  );
  return { counts, shown };
}
export function distinctOf(items: readonly DeadlineItem[], key: "office" | "owner"): string[] {
  return [...new Set(items.map((i) => i[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
}

/**
 * «Completata»: registra la data di chiusura. Se ricorre ogni anno aggiunge la
 * stessa scadenza per l'anno successivo (se non c'è già) e la restituisce.
 */
export function completeDeadline(rows: readonly (readonly string[])[], index: number, config: DeadlinesConfig, today: string): { rows: string[][]; next: string | null; full: boolean } {
  const out = rows.map((r) => [...r]);
  const row = out[index];
  if (!row || config.completedColumn === undefined) return { rows: out, next: null, full: false };
  row[config.completedColumn] = formatItalianDate(today);
  const date = parseDeadlineDate(row[config.dateColumn], today);
  // Una riga toccata dall'utente non segue più «oggi»: la sua data diventa fissa.
  if (date) row[config.dateColumn] = formatItalianDate(date);
  const recurrence = cellOf(row, config.recurrenceColumn);
  const yearly = yearlyPattern.test(recurrence);
  if (!date || !yearly) return { rows: out, next: null, full: false };
  const leapDay = date.endsWith("-02-29") || (date.slice(5, 7) === "02" && recurrence.includes(leapDayMark));
  const next = nextOccurrence(date, today, leapDay);
  const exists = out.some(
    (r) =>
      cellOf(r, config.descriptionColumn) === cellOf(row, config.descriptionColumn) &&
      parseDeadlineDate(r[config.dateColumn], today) === next,
  );
  if (exists) return { rows: out, next, full: false };
  if (out.length >= 30) return { rows: out, next: null, full: true };
  const copy = [...row];
  copy[config.dateColumn] = formatItalianDate(next);
  copy[config.completedColumn] = "";
  if (leapDay && config.recurrenceColumn !== undefined && !recurrence.includes(leapDayMark))
    copy[config.recurrenceColumn] = `${recurrence} ${leapDayMark}`.slice(0, 200);
  out.splice(index + 1, 0, copy);
  return { rows: out, next, full: false };
}
export function reopenDeadline(rows: readonly (readonly string[])[], index: number, config: DeadlinesConfig): string[][] {
  return rows.map((r, i) => (i === index && config.completedColumn !== undefined ? r.map((c, j) => (j === config.completedColumn ? "" : c)) : [...r]));
}

/** Giorni del calendario mensile (lunedì per primo), con le scadenze del giorno. */
export function calendarMonth(year: number, month: number, items: readonly DeadlineItem[]) {
  const first = `${year}-${pad(month)}-01`;
  const lead = (weekday(first) + 6) % 7;
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: ({ date: string; items: DeadlineItem[] } | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= length; d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    cells.push({ date, items: items.filter((i) => i.date === date) });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Testo dell'elenco filtrato: separato da tabulazioni (si incolla in Excel) o da «;» (file CSV). */
export function deadlinesTable(items: readonly DeadlineItem[], separator: "\t" | ";" = "\t"): string {
  const head = ["Stato", "Data", "Giorni", "Descrizione", "Ufficio", "Responsabile", "Norma", "Completata"];
  const quote = (v: string) => (separator === ";" && /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v.replace(/[\t\n]/g, " "));
  // Un testo che inizia con = + - @ diventerebbe una formula in Excel: si neutralizza con l'apostrofo.
  const text = (v: string) => quote(/^[=+\-@]/.test(v) ? `'${v}` : v);
  const lines = items.map((i) =>
    [
      text(deadlineLightLabels[i.light]),
      formatItalianDate(i.date),
      String(i.days),
      ...[i.description, i.office, i.owner, i.norm, i.completed && /^\d{4}-/.test(i.completed) ? formatItalianDate(i.completed) : i.completed].map(text),
    ].join(separator),
  );
  return [head.join(separator), ...lines].join("\n");
}
