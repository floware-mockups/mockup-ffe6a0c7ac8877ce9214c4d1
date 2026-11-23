// WZ-2126 (livello 2): logica pura del tipo di pagina «Confronto di due file».
// Riconosce le colonne, pulisce i dati (le «trappole»), confronta per chiave e
// prepara totali, grafico, ricerca ed esportazione. Solo dati in memoria:
// nessuna rete, nessun salvataggio. Importi in centesimi interi, mai in virgola
// mobile, così i totali tornano al centesimo.
// Copia identica in templates/mockup-v1/src/kinds/compareLogic.ts (verificata da un test).

/** Una cella letta da un file: numero, testo (anche un importo «scritto come testo») o vuota. */
export type CompareCell = string | number | null;
/**
 * Celle lette da un file. In un .xlsx ogni testo è un testo; in un CSV tutto è
 * testo e `quoted` dice quali celle erano fra virgolette: solo quelle contano
 * come «importo scritto come testo».
 */
export type CompareRawTable = { rows: CompareCell[][]; quoted?: boolean[][] };
export const compareRoles = ["key", "group", "subject", "description", "amount"] as const;
export type CompareRole = (typeof compareRoles)[number];
export type CompareField = { label: string; synonyms?: string[] };
export type CompareConfig = {
  /** Nome breve del primo e del secondo file, per esempio «2025» e «2026». */
  before: string;
  after: string;
  /** Colonna dei dati di esempio che dice a quale file appartiene ogni riga. */
  fileColumn: string;
  /** Chiave e importo sono obbligatori; gli altri campi sono facoltativi. */
  fields: { key: CompareField; amount: CompareField; group?: CompareField; subject?: CompareField; description?: CompareField };
  /** Plurale del raggruppamento, per esempio «Capitoli» (titolo del secondo foglio). */
  groupPlural?: string;
};
export const compareLimits = {
  fileBytes: 5 * 1024 * 1024,
  rows: 5000,
  columns: 60,
  headerScan: 10,
  /** Dimensione massima dichiarata del contenuto di un .xlsx, una volta estratto. */
  unzippedBytes: 40 * 1024 * 1024,
  zipEntries: 2000,
  /** Dimensione massima di una singola parte del .xlsx una volta estratta (per esempio il foglio). */
  unzippedEntryBytes: 16 * 1024 * 1024,
  /** Importo massimo accettato, in euro: oltre, i centesimi perderebbero precisione. */
  maxEuro: 1e13,
  /** Celle coperte, in tutto, dalle celle unite (o dalle regole di convalida) di un foglio. */
  mergedCells: 10_000,
} as const;

// --- Testi e numeri -------------------------------------------------------------

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/** «5.000»: il punto delle migliaia anche sotto i 10.000, senza dipendere dal browser. */
export const groupDigits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const cellText = (cell: CompareCell | undefined) => (cell === null || cell === undefined ? "" : String(cell).trim());

/**
 * Importo da testo. Se ci sono sia il punto sia la virgola, il separatore dei
 * decimali è quello più a destra; con la sola virgola la virgola è il decimale;
 * un solo punto seguito da tre cifre («1.250») è il separatore delle migliaia.
 * Accetta «€», «euro», spazi e il segno meno o le parentesi. null se non è un importo.
 */
export function parseAmount(text: string): number | null {
  // Valuta solo all'inizio o alla fine; gli spazi interni sono separatori delle migliaia.
  let s = text
    .trim()
    .replace(/^(?:€|eur(?:o)?)\s*/i, "")
    .replace(/\s*(?:€|eur(?:o)?)$/i, "")
    .replace(/[\s\u00a0]+/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^[-+]/.test(s)) {
    if (negative) return null;
    negative = s[0] === "-";
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;
  const grouped = (whole: string, sep: string) => new RegExp(`^(?:0|[1-9]\\d{0,2}(?:\\${sep}\\d{3})+|\\d+)$`).test(whole);
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  let normalized: string;
  if (dot >= 0 && comma >= 0) {
    const decimal = dot > comma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    const parts = s.split(decimal);
    if (parts.length !== 2 || !/^\d+$/.test(parts[1]) || !grouped(parts[0], thousands) || !parts[0].includes(thousands)) return null;
    normalized = parts[0].split(thousands).join("") + "." + parts[1];
  } else if (comma >= 0 || dot >= 0) {
    const sep = comma >= 0 ? "," : ".";
    const parts = s.split(sep);
    if (parts.length === 2 && !(sep === "." && /^[1-9]\d{0,2}\.\d{3}$/.test(s))) {
      // Un solo separatore: è il decimale («1250,5», «1250.50», «0.500»), salvo «1.250».
      if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
      normalized = parts[0] + "." + parts[1];
    } else {
      // Separatori delle migliaia: gruppi di tre cifre («1.234.567», «1.250»).
      if (!grouped(s, sep)) return null;
      normalized = parts.join("");
    }
  } else normalized = s;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value > compareLimits.maxEuro) return null;
  return negative && value !== 0 ? -value : value;
}
/** Centesimi interi; il piccolo margine evita che 0,285 diventi 28 per l'errore della virgola mobile. */
const toCents = (value: number) => {
  const cents = Math.round(Math.abs(value) * 100 + 1e-7);
  return value < 0 && cents ? -cents : cents;
};

/** «1.250,50 €», con il punto delle migliaia anche sotto i 10.000 e senza dipendere dal browser. */
export function formatEuro(cents: number, signed = false): string {
  const sign = cents < 0 ? "−" : signed && cents > 0 ? "+" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = groupDigits(Math.floor(abs / 100));
  return `${sign}${whole},${String(abs % 100).padStart(2, "0")} €`;
}
/** «+4,0%»; null se non c'è una base da cui partire. */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded < 0 ? "−" : rounded > 0 ? "+" : "";
  return `${sign}${Math.abs(rounded).toFixed(1).replace(".", ",")}%`;
}
/** Variazione percentuale rispetto al valore assoluto della base (anche negativa). */
const percent = (diff: number, base: number) => (base === 0 ? null : (diff / Math.abs(base)) * 100);

/**
 * Nome del soggetto per riconoscerlo scritto in modi diversi: maiuscolo, senza
 * punteggiatura né spazi doppi, «S.r.l.», «s.r.l» o «S R L» diventano «SRL»
 * (lo stesso per SPA, SNC e SAS).
 */
export function normalizeSubject(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleUpperCase("it-IT")
    .replace(/[.,;:'’"()\-/\\&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bS ?R ?L\b/g, "SRL")
    .replace(/\bS ?P ?A\b/g, "SPA")
    .replace(/\bS ?N ?C\b/g, "SNC")
    .replace(/\bS ?A ?S\b/g, "SAS");
}

// --- Colonne --------------------------------------------------------------------

export type CompareColumns = Partial<Record<CompareRole, number>>;
const fieldOf = (config: CompareConfig, role: CompareRole) => config.fields[role];
/** Nomi accettati per un campo: l'etichetta e i sinonimi, senza maiuscole, accenti e punteggiatura. */
export function compareNames(field: CompareField): string[] {
  return [...new Set([field.label, ...(field.synonyms ?? [])].map(plain).filter(Boolean))];
}
const containsWords = (cell: string, name: string) => ` ${cell} `.includes(` ${name} `);

/**
 * Trova la riga delle intestazioni (fra le prime righe) e la colonna di ogni
 * campo. Prima i nomi identici, poi quelli contenuti nell'intestazione
 * («Importo impegnato» vale come importo). Ogni colonna serve un solo campo.
 */
export function detectCompareColumns(rows: CompareCell[][], config: CompareConfig): { header: number; columns: CompareColumns } | null {
  let best: { header: number; columns: CompareColumns; score: number } | null = null;
  for (let r = 0; r < Math.min(rows.length, compareLimits.headerScan); r++) {
    const cells = rows[r].map((c) => plain(cellText(c)));
    const columns: CompareColumns = {};
    const used = new Set<number>();
    const roles = compareRoles.filter((role) => fieldOf(config, role));
    for (const pass of ["exact", "contains"] as const) {
      const order = pass === "exact" ? roles : (["amount", "key", "group", "subject", "description"] as const).filter((r) => roles.includes(r));
      for (const role of order) {
        if (columns[role] !== undefined) continue;
        // Prima l'etichetta, poi i sinonimi in ordine: «Importo» vince su «Totale» anche se sta più a destra.
        let at = -1;
        for (const n of compareNames(fieldOf(config, role)!)) {
          at = cells.findIndex((cell, i) => !used.has(i) && cell && (pass === "exact" ? cell === n : containsWords(cell, n)));
          if (at >= 0) break;
        }
        if (at >= 0) {
          columns[role] = at;
          used.add(at);
        }
      }
    }
    const score = Object.keys(columns).length;
    if (columns.key !== undefined && columns.amount !== undefined && (!best || score > best.score)) best = { header: r, columns, score };
  }
  return best && { header: best.header, columns: best.columns };
}

// --- Pulizia --------------------------------------------------------------------

export type CompareSide = "before" | "after";
export type CompareRecord = {
  /** Riga del file, contata da 1 come in Excel. */
  line: number;
  key: string;
  group: string;
  subject: string;
  subjectKey: string;
  description: string;
  cents: number;
};
export type CompareTrapKind = "subject" | "duplicate" | "text" | "unreadable" | "repeated" | "nokey";
export type CompareTrap = { kind: CompareTrapKind; text: string };
export type CompareFileResult = {
  side: CompareSide;
  records: CompareRecord[];
  /** Righe con dati lette dal file, duplicati compresi. */
  read: number;
  traps: CompareTrap[];
  /** Intestazioni riconosciute, per dire all'utente cosa è stato letto. */
  recognized: Partial<Record<CompareRole, string>>;
};
export class CompareFileError extends Error {}

const keyOf = (text: string) => text.replace(/\s+/g, " ").toLocaleUpperCase("it-IT");
const numberWords = ["zero", "un", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci"];
const quote = (text: string) => `«${text}»`;

/** Riconosce le colonne e pulisce un file. Lancia CompareFileError con un messaggio per l'utente. */
export function cleanCompareTable(table: CompareRawTable, config: CompareConfig, side: CompareSide): CompareFileResult {
  const name = side === "before" ? config.before : config.after;
  const rows = table.rows;
  if (!rows.some((row) => row.some((c) => cellText(c)))) throw new CompareFileError(`Il file del ${name} è vuoto.`);
  const found = detectCompareColumns(rows, config);
  if (!found) {
    const missing = (["key", "amount"] as const).map((role) => config.fields[role]);
    const hint = missing.map((f) => `${quote(f.label)}${f.synonyms?.length ? ` (va bene anche ${f.synonyms.slice(0, 3).join(", ")})` : ""}`).join(" e ");
    throw new CompareFileError(`Nel file del ${name} non trovo le colonne ${hint}. Controlla la riga delle intestazioni.`);
  }
  const { header, columns } = found;
  if (rows.length - header - 1 > compareLimits.rows)
    throw new CompareFileError(`Il file del ${name} ha più di ${groupDigits(compareLimits.rows)} righe: nel prototipo usa un file più piccolo.`);
  const recognized: CompareFileResult["recognized"] = {};
  for (const role of compareRoles) if (columns[role] !== undefined) recognized[role] = cellText(rows[header][columns[role]!]);
  const keyLabel = config.fields.key.label.toLocaleLowerCase("it-IT");
  const traps: CompareTrap[] = [];
  const records: CompareRecord[] = [];
  const seen = new Map<string, number>();
  const amounts = new Map<string, number>();
  let read = 0;
  let noKey = 0;
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some((c) => cellText(c))) continue;
    read++;
    const at = (role: CompareRole) => (columns[role] === undefined ? "" : cellText(row[columns[role]!]));
    const key = at("key");
    if (!key) {
      noKey++;
      continue;
    }
    const line = r + 1;
    const rawAmount = columns.amount === undefined ? null : row[columns.amount];
    let cents = 0;
    const asText = !table.quoted || Boolean(table.quoted[r]?.[columns.amount!]);
    if (typeof rawAmount === "number" && Number.isFinite(rawAmount) && Math.abs(rawAmount) <= compareLimits.maxEuro) cents = toCents(rawAmount);
    else {
      const text = cellText(rawAmount);
      const value = text && typeof rawAmount === "string" ? parseAmount(text) : null;
      if (value === null) traps.push({ kind: "unreadable", text: `Nel file del ${name}, riga ${line} (${keyLabel} ${key}): l'importo ${quote(text || "vuoto")} non è un numero ed è contato come zero.` });
      else {
        cents = toCents(value);
        if (asText) traps.push({ kind: "text", text: `Nel file del ${name}, riga ${line} (${keyLabel} ${key}): l'importo ${quote(text)} è scritto come testo ed è letto come ${formatEuro(cents)}.` });
      }
    }
    const subject = at("subject").replace(/\s+/g, " ");
    const record: CompareRecord = { line, key, group: at("group"), subject, subjectKey: normalizeSubject(subject), description: at("description"), cents };
    const signature = `${keyOf(key)}\u0000${cents}\u0000${record.subjectKey}`;
    if (seen.has(signature)) {
      traps.push({ kind: "duplicate", text: `Nel file del ${name} la riga ${line} ripete la riga ${seen.get(signature)} (${keyLabel} ${key}, stesso importo e stesso ${(config.fields.subject?.label ?? "soggetto").toLocaleLowerCase("it-IT")}): è contata una volta sola.` });
      continue;
    }
    seen.set(signature, line);
    if (amounts.has(keyOf(key)))
      traps.push({ kind: "repeated", text: `Nel file del ${name} ${keyLabel} ${key} compare più volte (righe ${amounts.get(keyOf(key))} e ${line}): gli importi sono sommati.` });
    else amounts.set(keyOf(key), line);
    records.push(record);
  }
  if (noKey) traps.push({ kind: "nokey", text: `Nel file del ${name} ${noKey === 1 ? "una riga non ha" : `${noKey} righe non hanno`} ${keyLabel}: ${noKey === 1 ? "è esclusa" : "sono escluse"} dal confronto.` });
  return { side, records, read, traps, recognized };
}

// --- Confronto ------------------------------------------------------------------

export type CompareStatus = "new" | "removed" | "changed" | "same";
export type CompareDifference = {
  key: string;
  status: CompareStatus;
  group: string;
  subject: string;
  description: string;
  before: number | null;
  after: number | null;
  diff: number;
};
export type CompareGroupTotal = { group: string; before: number; after: number; diff: number; percent: number | null; isNew: boolean };
export type CompareResult = {
  /** Campi facoltativi trovati in almeno uno dei due file. */
  has: Record<"group" | "subject" | "description", boolean>;
  differences: CompareDifference[];
  counts: Record<CompareStatus, number>;
  totals: { before: number; after: number; diff: number; percent: number | null };
  groups: CompareGroupTotal[];
  traps: CompareTrap[];
  before: CompareFileResult;
  after: CompareFileResult;
};
export const compareStatusLabels: Record<CompareStatus, string> = { new: "Nuova", removed: "Sparita", changed: "Cambiata", same: "Uguale" };
const byText = (a: string, b: string) => a.localeCompare(b, "it-IT", { numeric: true, sensitivity: "base" });

type Bucket = { key: string; cents: number; first: CompareRecord };
const bucketsOf = (records: CompareRecord[]) => {
  const out = new Map<string, Bucket>();
  for (const record of records) {
    const k = keyOf(record.key);
    const bucket = out.get(k);
    if (bucket) bucket.cents += record.cents;
    else out.set(k, { key: record.key, cents: record.cents, first: record });
  }
  return out;
};
const sum = (records: CompareRecord[]) => records.reduce((s, r) => s + r.cents, 0);

/** Soggetti scritti in modi diversi, nei due file insieme. */
function subjectTraps(records: CompareRecord[], config: CompareConfig): CompareTrap[] {
  const label = (config.fields.subject?.label ?? "soggetto").toLocaleLowerCase("it-IT");
  const spellings = new Map<string, string[]>();
  for (const r of records) {
    if (!r.subjectKey) continue;
    const list = spellings.get(r.subjectKey) ?? [];
    if (!list.includes(r.subject)) list.push(r.subject);
    spellings.set(r.subjectKey, list);
  }
  return [...spellings]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      kind: "subject" as const,
      text: `Il ${label} ${quote(key)} è scritto in ${numberWords[list.length] ?? list.length} modi: ${list.map(quote).join(", ")}. Nel confronto è lo stesso ${label}.`,
    }));
}

export function compareFiles(beforeTable: CompareRawTable, afterTable: CompareRawTable, config: CompareConfig): CompareResult {
  const before = cleanCompareTable(beforeTable, config, "before");
  const after = cleanCompareTable(afterTable, config, "after");
  const a = bucketsOf(before.records);
  const b = bucketsOf(after.records);
  const differences: CompareDifference[] = [];
  for (const k of [...new Set([...a.keys(), ...b.keys()])]) {
    const x = a.get(k);
    const y = b.get(k);
    const info = (y ?? x)!.first;
    const status: CompareStatus = !x ? "new" : !y ? "removed" : x.cents !== y.cents ? "changed" : "same";
    differences.push({
      key: (y ?? x)!.key,
      status,
      group: info.group,
      subject: info.subject,
      description: info.description,
      before: x ? x.cents : null,
      after: y ? y.cents : null,
      diff: (y?.cents ?? 0) - (x?.cents ?? 0),
    });
  }
  differences.sort((p, q) => byText(p.key, q.key));
  const counts: Record<CompareStatus, number> = { new: 0, removed: 0, changed: 0, same: 0 };
  for (const d of differences) counts[d.status]++;
  const totalBefore = sum(before.records);
  const totalAfter = sum(after.records);
  const groups = new Map<string, CompareGroupTotal>();
  const add = (records: CompareRecord[], side: "before" | "after") => {
    for (const r of records) {
      // «Cap. 1» e «cap.  1» sono lo stesso raggruppamento; uno vuoto si chiama «—».
      const k = keyOf(r.group);
      const g = groups.get(k) ?? { group: r.group || "—", before: 0, after: 0, diff: 0, percent: null, isNew: true };
      g[side] += r.cents;
      if (side === "before") g.isNew = false;
      groups.set(k, g);
    }
  };
  add(before.records, "before");
  add(after.records, "after");
  const groupList = [...groups.values()]
    .map((g) => ({ ...g, diff: g.after - g.before, percent: g.isNew ? null : percent(g.after - g.before, g.before) }))
    .sort((p, q) => byText(p.group, q.group));
  const has = Object.fromEntries((["group", "subject", "description"] as const).map((role) => [role, Boolean(config.fields[role]) && (before.recognized[role] !== undefined || after.recognized[role] !== undefined)])) as CompareResult["has"];
  return {
    has,
    differences,
    counts,
    totals: { before: totalBefore, after: totalAfter, diff: totalAfter - totalBefore, percent: percent(totalAfter - totalBefore, totalBefore) },
    groups: has.group ? groupList : [],
    traps: [...subjectTraps([...before.records, ...after.records], config), ...before.traps, ...after.traps].sort((p, q) => trapOrder.indexOf(p.kind) - trapOrder.indexOf(q.kind)),
    before,
    after,
  };
}
const trapOrder: CompareTrapKind[] = ["subject", "duplicate", "repeated", "text", "unreadable", "nokey"];

/** I raggruppamenti cresciuti di più (solo quelli cresciuti), dal più alto. */
export function topGrowth(result: CompareResult, limit = 5): CompareGroupTotal[] {
  return result.groups.filter((g) => g.diff > 0).sort((p, q) => q.diff - p.diff || byText(p.group, q.group)).slice(0, limit);
}

/** Spesa di un soggetto nei due file, cercando sul nome normalizzato. */
export function searchSubject(result: CompareResult, query: string) {
  const q = normalizeSubject(query);
  if (!q) return null;
  // Ogni parola cercata deve essere l'inizio di una parola del nome («ross» trova «ROSSI SRL»).
  const words = q.split(" ");
  const match = (r: CompareRecord) => {
    const name = r.subjectKey.split(" ");
    return words.every((w) => name.some((n) => n.startsWith(w)));
  };
  const before = result.before.records.filter(match);
  const after = result.after.records.filter(match);
  const names = [...new Set([...before, ...after].map((r) => r.subjectKey))].sort(byText);
  const b = sum(before);
  const a = sum(after);
  return { names, before: b, after: a, diff: a - b, percent: percent(a - b, b), found: before.length + after.length };
}

// --- Dati di esempio ------------------------------------------------------------

/**
 * Dati di esempio dalla tabella della pagina: la colonna `fileColumn` dice a
 * quale file appartiene ogni riga. Un importo fra virgolette («"1.250,50"») è
 * un importo scritto come testo; gli altri numeri diventano numeri.
 */
export function compareSampleTables(page: { columns: string[]; rows: string[][] }, config: CompareConfig): Record<CompareSide, CompareRawTable> {
  const fileAt = page.columns.findIndex((c) => plain(c) === plain(config.fileColumn));
  const keep = page.columns.map((_, i) => i).filter((i) => i !== fileAt);
  const header = keep.map((i) => page.columns[i]);
  // Solo l'importo diventa un numero, con le regole di parseAmount («3.200» vale
  // 3.200 euro); chiave e raggruppamento restano testo («0101» resta «0101»).
  const amountAt = detectCompareColumns([header], config)?.columns.amount ?? -1;
  const quote = /^["“«](.*)["”»]$/;
  const cell = (text: string, at: number): CompareCell => {
    const t = text.trim();
    if (!t || t === "—") return null;
    const quoted = quote.exec(t);
    if (quoted) return quoted[1];
    return at === amountAt ? (parseAmount(t) ?? t) : t;
  };
  const side = (name: string): CompareRawTable => {
    const rows = page.rows.filter((row) => fileAt >= 0 && (row[fileAt] ?? "").trim() === name.trim()).map((row) => keep.map((i) => row[i] ?? ""));
    return {
      rows: [header, ...rows.map((row) => row.map((text, at) => cell(text, at)))],
      // Fra virgolette = scritto come testo (le trappole); il resto è un valore.
      quoted: [header.map(() => false), ...rows.map((row) => row.map((text) => quote.test(text.trim())))],
    };
  };
  return { before: side(config.before), after: side(config.after) };
}

/**
 * Testo CSV (separatore punto e virgola, come nell'Excel italiano). Fra
 * virgolette vanno le celle segnate in `quoted` (gli importi scritti come
 * testo) e quelle con caratteri speciali; senza `quoted`, ogni testo che sembra
 * un importo.
 */
export function compareCsv(table: CompareRawTable): string {
  const field = (c: CompareCell, r: number, i: number) => {
    if (c === null) return "";
    if (typeof c === "number") return String(c);
    const asText = table.quoted ? Boolean(table.quoted[r]?.[i]) : parseAmount(c) !== null;
    return asText || /[";\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
  };
  return table.rows.map((row, r) => row.map((c, i) => field(c, r, i)).join(";")).join("\r\n") + "\r\n";
}

// --- Esportazione ---------------------------------------------------------------

/** `money`: colonne in euro; `fromFile`: colonne con testi presi dai file (protetti nel «Copia»). */
export type CompareSheet = { name: string; header: string[]; rows: (string | number | null)[][]; money: number[]; fromFile: number[] };
/**
 * Testo da incollare: tabulazioni e a capo diventano spazi (non creano celle
 * nuove) e un testo che inizia con = + - @ si fa precedere da un apice, così
 * incollato in un foglio non diventa una formula. Nel file .xlsx non serve:
 * exceljs scrive sempre i testi come testi.
 */
const safeText = (text: string) => {
  const flat = text.replace(/[\t\r\n]+/g, " ");
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
};
const sheetName = (text: string, fallback: string) => (text.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || fallback);

/** I due fogli dell'esportazione: «Differenze» e i totali per raggruppamento (importi in euro). */
export function compareSheets(result: CompareResult, config: CompareConfig): CompareSheet[] {
  const f = config.fields;
  const euro = (cents: number | null) => (cents === null ? null : cents / 100);
  const textColumns = (["key", "group", "subject", "description"] as const).filter((role) => role === "key" || result.has[role]);
  const differences: CompareSheet = {
    name: "Differenze",
    header: [...textColumns.map((role) => f[role]!.label), "Esito", `Prima (${config.before})`, `Dopo (${config.after})`, "Differenza"],
    rows: result.differences
      .filter((d) => d.status !== "same")
      .map((d) => [...textColumns.map((role) => d[role]), compareStatusLabels[d.status], euro(d.before), euro(d.after), euro(d.diff)]),
    money: [textColumns.length + 1, textColumns.length + 2, textColumns.length + 3],
    fromFile: textColumns.map((_, i) => i),
  };
  const sheets = [differences];
  if (f.group && result.has.group) {
    sheets.push({
      name: sheetName(config.groupPlural ?? f.group.label, "Totali"),
      header: [f.group.label, config.before, config.after, "Differenza", "Differenza %"],
      rows: [
        ...result.groups.map((g) => [g.group, euro(g.before), euro(g.after), euro(g.diff), g.isNew ? "nuovo" : formatPercent(g.percent)]),
        ["Totale", euro(result.totals.before), euro(result.totals.after), euro(result.totals.diff), formatPercent(result.totals.percent)],
      ],
      money: [1, 2, 3],
      fromFile: [0],
    });
  }
  return sheets;
}

/** Testo da incollare (colonne separate da tabulazioni): riepilogo, trappole e i due fogli. */
export function compareCopyText(result: CompareResult, config: CompareConfig): string {
  const cell = (sheet: CompareSheet, v: string | number | null, i: number) =>
    typeof v === "number" ? v.toFixed(2).replace(".", ",") : sheet.fromFile.includes(i) ? safeText(v ?? "") : (v ?? "");
  const lines = [
    `Confronto ${config.before} – ${config.after}`,
    `Nuove: ${result.counts.new}\tSparite: ${result.counts.removed}\tCambiate: ${result.counts.changed}`,
    `Totale ${config.before}: ${formatEuro(result.totals.before)}\tTotale ${config.after}: ${formatEuro(result.totals.after)}\tDifferenza: ${formatEuro(result.totals.diff, true)} (${formatPercent(result.totals.percent)})`,
    "",
    "Trappole trovate",
    ...(result.traps.length ? result.traps.map((t) => `- ${safeText(t.text)}`) : ["Nessuna"]),
  ];
  for (const sheet of compareSheets(result, config)) {
    lines.push("", sheet.name, sheet.header.join("\t"));
    for (const row of sheet.rows) lines.push(row.map((v, i) => cell(sheet, v, i)).join("\t"));
  }
  return lines.join("\n") + "\n";
}

// --- Configurazione -------------------------------------------------------------

/** Testo per dire quali colonne sono state riconosciute in un file. */
export function describeRecognized(file: CompareFileResult, config: CompareConfig): string {
  return compareRoles
    .filter((role) => file.recognized[role] !== undefined && config.fields[role])
    .map((role) => (plain(file.recognized[role]!) === plain(config.fields[role]!.label) ? config.fields[role]!.label : `${config.fields[role]!.label} (${file.recognized[role]})`))
    .join(", ");
}
