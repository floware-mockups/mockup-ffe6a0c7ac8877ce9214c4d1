// WZ-2126 (livello 4): tipo di pagina «Documento da modello». Logica pura,
// condivisa dal template pubblicato e dall'anteprima di FlowareHub (copia
// identica in shared/mockupKinds/documentLogic.ts, verificata da un test).
// Solo dati in memoria: nessuna rete, nessun codice dinamico.

export type DocumentFieldType = "text" | "long" | "number" | "percent" | "choice";
export type DocumentField = {
  key: string;
  label: string;
  type: DocumentFieldType;
  required?: boolean;
  options?: string[];
  /** Valore iniziale (per esempio «0» per lo sconto). */
  default?: string;
  /** Esattamente N cifre (per esempio la partita IVA). */
  digits?: number;
  /** Esattamente N caratteri, lettere o numeri (per esempio il codice di gara). */
  length?: number;
  /** Numeri: estremi ammessi; `positive` = maggiore di zero. */
  min?: number;
  max?: number;
  positive?: boolean;
  /** Testo usato se il campo resta vuoto (può contenere segnaposto). */
  fallback?: string;
  /** Il campo si può far scrivere all'assistente AI (per esempio la motivazione). */
  ai?: boolean;
};
export type DocumentRule =
  | {
      /** Soglia su un valore (un campo numerico o «netto»/«totale» del riepilogo). */
      type: "threshold";
      value: string;
      atLeast: number;
      /** Vale solo se il campo ha uno di questi valori. */
      when?: { field: string; in: string[] };
      level: "error" | "warning";
      message: string;
    }
  | { type: "different"; fields: [string, string]; level: "error" | "warning"; message: string };
export type DocumentMap = { key: string; from: string; values: Record<string, string>; otherwise: string };
export type DocumentConfig = {
  fields: DocumentField[];
  /** Riepilogo calcolato: importo netto, sconto in percentuale e aliquota IVA. */
  summary?: { amount: string; discount?: string; vat?: number };
  rules?: DocumentRule[];
  /** Valori derivati da una scelta (per esempio «Area Tecnica» per i lavori). */
  maps?: DocumentMap[];
  /** Testo del documento con segnaposto {campo}, {campo|maiuscolo}, {?campo}…{/campo}. */
  template: string;
  /** Etichetta del pulsante, per esempio «Genera la determina». */
  generateLabel?: string;
  /** Campi mandati all'assistente per scrivere il campo `ai` (oltre al netto); senza, solo le scelte e i testi brevi. */
  aiFields?: string[];
  /** Pratiche di esempio: pulsanti che compilano i campi. */
  examples?: { label: string; values: Record<string, string> }[];
};

// ---- Numeri ----------------------------------------------------------------

/**
 * Numero scritto all'italiana o all'inglese: «4.800», «4800», «1.250,50»,
 * «1250.50», «10%». Con punto e virgola insieme il decimale è quello più a
 * destra; con la sola virgola è la virgola; con il solo punto è il decimale
 * solo se non separa gruppi di tre cifre. null se non è un numero.
 */
export function parseItalianNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).replace(/[€\s\u00a0%]|euro/gi, "");
  if (!s) return null;
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    s = dot > comma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (comma >= 0) {
    if (s.split(",").length > 2) return null;
    s = s.replace(",", ".");
  } else if (dot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** Centesimi interi, arrotondati al centesimo. */
export const toCents = (euro: number) => Math.round(euro * 100);
/** «5.856,00» (centesimi in ingresso). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const units = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${units},${String(abs % 100).padStart(2, "0")}`;
}
/** «5.856,00 euro». */
export const formatEuro = (cents: number) => `${formatCents(cents)} euro`;

const units = ["zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove"];
const tens = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"];
/** Da 0 a 999, senza accento finale (lo aggiunge `numberInWords`). */
function upTo999(n: number): string {
  if (n < 20) return units[n];
  if (n < 100) {
    const t = tens[Math.floor(n / 10)];
    const u = n % 10;
    if (!u) return t;
    // ventuno, ventotto: la vocale finale delle decine cade davanti a «uno» e «otto».
    return (u === 1 || u === 8 ? t.slice(0, -1) : t) + units[u];
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = h === 1 ? "cento" : units[h] + "cento";
  if (!rest) return head;
  const tail = upTo999(rest);
  // centottanta, centotto: «cento» perde la «o» davanti a «otto» e «ottanta».
  return (tail.startsWith("ott") ? head.slice(0, -1) : head) + tail;
}
/** Numero intero in lettere, con le regole italiane (ventitré, mille, duemila, unmilione). */
export function numberInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "zero";
  // Oltre i 999 miliardi si resta alle cifre (gli importi più grandi sono già un errore).
  if (n >= 1e12) return String(n);
  const parts: string[] = [];
  const scales: [number, string, string][] = [
    [1_000_000_000, "unmiliardo", "miliardi"],
    [1_000_000, "unmilione", "milioni"],
  ];
  for (const [size, one, many] of scales) {
    const q = Math.floor(n / size);
    if (q) parts.push(q === 1 ? one : upTo999Thousands(q) + many);
    n %= size;
  }
  const thousands = Math.floor(n / 1000);
  if (thousands) parts.push(thousands === 1 ? "mille" : upTo999(thousands) + "mila");
  n %= 1000;
  if (n) parts.push(upTo999(n));
  const words = parts.join("");
  // ventitré, centotré, milletré: «tre» finale accentato se non è da solo.
  return words.endsWith("tre") && words !== "tre" ? words.slice(0, -3) + "tré" : words;
}
/** Moltiplicatore di milioni e miliardi (fino a 999.999): «duecentomila», «tremila». */
function upTo999Thousands(n: number): string {
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  return (th ? (th === 1 ? "mille" : upTo999(th) + "mila") : "") + (rest ? upTo999(rest) : "");
}
/** «euro cinquemilaottocentocinquantasei/00» (centesimi in ingresso). */
export function amountInWords(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${cents < 0 ? "meno " : ""}euro ${numberInWords(Math.floor(abs / 100))}/${String(abs % 100).padStart(2, "0")}`;
}

// ---- Riepilogo e controlli ---------------------------------------------------

export type DocumentValues = Record<string, string>;
export type DocumentSummary = {
  amount: number;
  discount: number;
  net: number;
  vat: number;
  total: number;
  vatRate: number;
  totalInWords: string;
};
export type DocumentIssue = { level: "error" | "warning"; field?: string; message: string };

/** Valori iniziali: i predefiniti dei campi, poi quelli passati. */
export function initialDocumentValues(config: DocumentConfig, values: DocumentValues = {}): DocumentValues {
  const out: DocumentValues = {};
  for (const f of config.fields) out[f.key] = values[f.key] ?? f.default ?? "";
  return out;
}
/** Netto dopo lo sconto, IVA e totale in centesimi; null se manca l'importo. */
export function documentSummary(config: DocumentConfig, values: DocumentValues): DocumentSummary | null {
  if (!config.summary) return null;
  const amount = parseItalianNumber(values[config.summary.amount]);
  if (amount === null || Math.abs(amount) > documentMaxAmount) return null;
  const rawDiscount = config.summary.discount ? parseItalianNumber(values[config.summary.discount]) : 0;
  const discount = rawDiscount !== null && rawDiscount >= 0 && rawDiscount <= 99 ? rawDiscount : 0;
  const vatRate = config.summary.vat ?? 22;
  // Solo interi: centesimi e sconto in centesimi di punto, arrotondamento al centesimo
  // più vicino (metà per eccesso), senza errori di virgola mobile.
  const cents = BigInt(toCents(amount));
  const net = roundedDiv(cents * BigInt(10000 - Math.round(discount * 100)), BigInt(10000));
  const vat = roundedDiv(net * BigInt(vatRate), BigInt(100));
  return { amount: Number(cents), discount, net: Number(net), vat: Number(vat), total: Number(net + vat), vatRate, totalInWords: amountInWords(Number(net + vat)) };
}
/** Divisione intera con arrotondamento al più vicino (metà lontano da zero). */
function roundedDiv(n: bigint, d: bigint): bigint {
  const zero = BigInt(0);
  const half = d / BigInt(2);
  return n >= zero ? (n + half) / d : -((-n + half) / d);
}
const isEmpty = (v: string | undefined) => !v || !v.trim();
const labelOf = (config: DocumentConfig, key: string) => config.fields.find((f) => f.key === key)?.label ?? key;
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
/** Importo massimo accettato: oltre è quasi certamente un errore di battitura. */
export const documentMaxAmount = 999_999_999_999;
const decimals = (raw: string) => {
  const s = raw.replace(/[€\s\u00a0%]|euro/gi, "");
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  const sep = comma >= 0 ? comma : dot >= 0 && !/^-?\d{1,3}(\.\d{3})+$/.test(s) ? dot : -1;
  return sep < 0 ? 0 : s.length - sep - 1;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Errori (bloccano la generazione) e avvisi, aggiornati a ogni modifica. */
export function documentIssues(config: DocumentConfig, values: DocumentValues): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const missing = config.fields.filter((f) => f.required && isEmpty(values[f.key]));
  if (missing.length)
    issues.push({ level: "error", message: `Campi obbligatori mancanti: ${missing.map((f) => f.label).join(", ")}.` });
  for (const f of config.fields) {
    const raw = (values[f.key] ?? "").trim();
    if (!raw) continue;
    if (f.digits !== undefined) {
      const count = (raw.match(/\d/g) ?? []).length;
      if (!/^\d+$/.test(raw) || count !== f.digits)
        issues.push({ level: "error", field: f.key, message: `${f.label}: servono esattamente ${f.digits} cifre (ora ${plural(count, "cifra", "cifre")}${/^\d*$/.test(raw) ? "" : " e altri caratteri"}).` });
    }
    if (f.length !== undefined && !(raw.length === f.length && /^[A-Za-z0-9]+$/.test(raw)))
      issues.push({ level: "error", field: f.key, message: `${f.label}: servono esattamente ${f.length} caratteri, lettere o numeri (ora ${plural(raw.length, "carattere", "caratteri")}).` });
    if (f.type === "number" || f.type === "percent") {
      const n = parseItalianNumber(raw);
      if (n === null) issues.push({ level: "error", field: f.key, message: `${f.label}: scrivi un numero, per esempio 4.800 oppure 4800,50.` });
      else if (decimals(raw) > 2) issues.push({ level: "error", field: f.key, message: `${f.label}: al massimo due cifre dopo la virgola.` });
      else if (Math.abs(n) > documentMaxAmount) issues.push({ level: "error", field: f.key, message: `${f.label}: importo troppo grande.` });
      else if (f.positive && toCents(n) <= 0) issues.push({ level: "error", field: f.key, message: `${f.label}: deve essere maggiore di zero.` });
      else if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max))
        issues.push({ level: "error", field: f.key, message: `${f.label}: deve essere tra ${f.min ?? "−∞"} e ${f.max ?? "+∞"}${f.type === "percent" ? "%" : ""}.` });
    }
    if (f.type === "choice" && f.options?.length && !f.options.some((o) => fold(o) === fold(raw)))
      issues.push({ level: "error", field: f.key, message: `${f.label}: scegli fra ${f.options.join(", ")}.` });
  }
  const summary = documentSummary(config, values);
  for (const rule of config.rules ?? []) {
    if (rule.type === "different") {
      const [a, b] = rule.fields;
      if (!isEmpty(values[a]) && fold(values[a]) === fold(values[b] ?? "")) issues.push({ level: rule.level, field: b, message: rule.message });
      continue;
    }
    if (rule.when && !rule.when.in.some((v) => fold(v) === fold(values[rule.when!.field] ?? ""))) continue;
    const value =
      rule.value === "netto" ? (summary ? summary.net / 100 : null) : rule.value === "totale" ? (summary ? summary.total / 100 : null) : parseItalianNumber(values[rule.value]);
    if (value !== null && value >= rule.atLeast) issues.push({ level: rule.level, message: rule.message });
  }
  // L'assistente sostituisce i nomi di persona con «Persona A»: un testo che li contiene va riletto.
  if (config.fields.some((f) => /\bPersona [A-Z]\b/.test(values[f.key] ?? "")))
    issues.push({ level: "warning", message: documentPlaceholderNameWarning });
  return issues;
}
export const documentPlaceholderNameWarning = "Controlla i nomi: l'assistente ha sostituito un nome con «Persona A» (o simile). Scrivi il nome giusto o togli il riferimento.";
export const documentBlocked = (issues: readonly DocumentIssue[]) => issues.some((i) => i.level === "error");

// ---- Testo dal modello -------------------------------------------------------

export type DocumentContext = { number: number; year: number };
/** Valori dei segnaposto: campi (con i testi di riserva), derivati, riepilogo, numero e anno. */
export function documentPlaceholders(config: DocumentConfig, values: DocumentValues, context: DocumentContext): Record<string, string> {
  const out: Record<string, string> = { numero: String(context.number), anno: String(context.year) };
  for (const f of config.fields) out[f.key] = (values[f.key] ?? "").trim();
  for (const m of config.maps ?? []) {
    const from = fold(out[m.from] ?? "");
    const hit = Object.entries(m.values).find(([k]) => fold(k) === from);
    out[m.key] = hit ? hit[1] : m.otherwise;
  }
  const summary = documentSummary(config, values);
  if (summary) {
    out.netto = formatEuro(summary.net);
    out.iva = formatEuro(summary.vat);
    out.totale = formatEuro(summary.total);
    out.totale_lettere = summary.totalInWords;
    out.aliquota = String(summary.vatRate);
    if (config.summary?.discount) out[config.summary.discount] = summary.discount ? String(summary.discount).replace(".", ",") : "";
  }
  // Testi di riserva (per esempio la motivazione predefinita) dopo gli altri valori, così possono usarli.
  for (const f of config.fields) if (!out[f.key] && f.fallback) out[f.key] = fillPlaceholders(f.fallback, out);
  return out;
}
/** Segnaposto calcolati, sempre disponibili nel testo del modello. */
export const documentComputedKeys = ["numero", "anno", "netto", "iva", "totale", "totale_lettere", "aliquota"];
/**
 * Problema nel testo del modello, o null: ogni graffa è un segnaposto noto
 * ({campo}, {campo|maiuscolo}, {?campo}…{/campo}) riferito a un campo, a un
 * valore derivato o a un segnaposto calcolato, e i blocchi sono chiusi in ordine.
 */
export function documentTemplateProblem(config: Pick<DocumentConfig, "fields" | "maps">, template: string): string | null {
  const known = new Set([...config.fields.map((f) => f.key), ...(config.maps ?? []).map((m) => m.key), ...documentComputedKeys]);
  const open: string[] = [];
  for (const m of template.matchAll(/\{([^{}]*)\}|[{}]/g)) {
    if (m[1] === undefined) return `Graffa senza segnaposto: «${m[0]}».`;
    const token = /^([?/])?([a-z0-9_]+)(\|maiuscolo)?$/.exec(m[1]);
    if (!token || (token[1] && token[3])) return `Segnaposto non valido: «{${m[1]}}».`;
    if (!known.has(token[2])) return `Segnaposto sconosciuto: «{${m[1]}}».`;
    if (token[1] === "?") open.push(token[2]);
    else if (token[1] === "/" && open.pop() !== token[2]) return `Blocco chiuso male: «{${m[1]}}».`;
  }
  return open.length ? `Blocco non chiuso: «{?${open[open.length - 1]}}».` : null;
}
/** Sostituisce {campo}, {campo|maiuscolo} e i blocchi {?campo}…{/campo} (solo se il campo ha un valore). */
export function fillPlaceholders(template: string, values: Record<string, string>): string {
  const present = (key: string) => {
    const v = (values[key] ?? "").trim();
    return v !== "" && v !== "0";
  };
  const conditional = template.replace(/\{\?([a-z0-9_]+)\}([\s\S]*?)\{\/\1\}/g, (_, key: string, body: string) => (present(key) ? body : ""));
  return conditional.replace(/\{([a-z0-9_]+)(\|maiuscolo)?\}/g, (_, key: string, upper?: string) => {
    const v = values[key];
    if (v === undefined || v === "") return `[${key.replace(/_/g, " ")}]`;
    return upper ? v.toLocaleUpperCase("it") : v;
  });
}
/** Testo completo del documento con i dati di adesso. */
export function documentText(config: DocumentConfig, values: DocumentValues, context: DocumentContext): string {
  return fillPlaceholders(config.template, documentPlaceholders(config, values, context));
}
/** Campi da mandare all'assistente per scrivere un campo (solo dati del modulo, mai altro). */
export function documentAiFields(config: DocumentConfig, values: DocumentValues): Record<string, string> {
  const out: Record<string, string> = {};
  const wanted = config.aiFields
    ? config.fields.filter((f) => config.aiFields!.includes(f.key))
    : config.fields.filter((f) => !f.ai && (f.type === "choice" || (f.type === "text" && f.digits === undefined && f.length === undefined)));
  for (const f of wanted.slice(0, 8)) if (!isEmpty(values[f.key])) out[f.label] = values[f.key].trim().slice(0, 300);
  const summary = documentSummary(config, values);
  if (summary) out["Importo netto dopo lo sconto"] = formatEuro(summary.net);
  return out;
}
export const documentLabel = labelOf;
