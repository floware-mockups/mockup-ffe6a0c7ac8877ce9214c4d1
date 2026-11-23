// WZ-2126 (livello 3): tipo di pagina «Testo da appunti». Logica pura,
// condivisa dal template pubblicato e dall'anteprima di FlowareHub (copia
// identica in shared/mockupKinds/composeLogic.ts, verificata da un test).
// Il corpo lo scrive l'assistente AI (fuori da qui) oppure la composizione
// semplice di questo file. Nessuna rete, nessun codice dinamico.

export type ComposeConfig = {
  /** Righe dell'intestazione, per esempio «COMUNE DI BORGOVERDE», «Il Segretario comunale». */
  header: string[];
  /** Nome del documento numerato, per esempio «Circolare» → «Circolare n. 3/2026». */
  documentName: string;
  /** Luogo prima della data, per esempio «Borgoverde». */
  place: string;
  /** Firma in fondo, per esempio «Il Segretario comunale». */
  signature: string;
  recipients: string;
  tones: string[];
  /** Parole oltre le quali una frase riceve un avviso (predefinito 25). */
  maxWords?: number;
  /** Primo numero progressivo (predefinito 1). */
  firstNumber?: number;
  example?: { subject: string; notes: string; recipients?: string; tone?: string };
};
export type ComposeIssue = { level: "error" | "warning"; message: string; match?: string };

const months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
/** «19 novembre 2026». */
export const dateInWords = (d: Date) => `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
const daysIn = (month: number, year?: number) =>
  month === 2 ? (year === undefined || (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
const fullYear = (y?: string) => (y === undefined ? undefined : y.length === 2 ? 2000 + Number(y) : Number(y));

/** Abbreviazioni comuni negli appunti d'ufficio (senza il punto, minuscole). */
export const composeAbbreviations = ["mod", "resp", "art", "artt", "ecc", "pag", "dott", "dott.ssa", "sig", "sigg", "ing", "avv", "rag", "geom", "prot", "all", "tel", "lett", "cfr", "es", "rif", "uff", "amm", "sett", "dir", "dip", "pers", "rich", "comm", "c.a", "p.es", "d.lgs", "d.l", "d.p.r", "l", "co", "u.o", "p.a", "s.r.l", "s.p.a"];
const abbreviation = new Set(composeAbbreviations);
const word = String.raw`[A-Za-zÀ-ÖØ-öø-ÿ]`;

/** Divide un testo in frasi: punto, punto esclamativo o interrogativo e a capo; non dopo un'abbreviazione nota. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let current = "";
  const tokens = text.replace(/\r/g, "").split(/(\n+|(?<=[.!?])\s+)/);
  // Prima parola dopo il punto: un'abbreviazione seguita da minuscola o cifra non chiude la frase.
  const nextWord = (from: number) => tokens.slice(from).find((t) => t && !/^\s+$/.test(t)) ?? "";
  for (const [i, token] of tokens.entries()) {
    if (/^\s+$/.test(token) || token === "") {
      if (/\n/.test(token)) {
        if (current.trim()) out.push(current.trim());
        current = "";
      } else current += token;
      continue;
    }
    current += token;
    const last = /([A-Za-zÀ-ÿ.]+)\.$/.exec(current.trim());
    const ends = /[.!?]$/.test(current.trim());
    const short = last && (abbreviation.has(last[1].toLowerCase()) || /^nn?$/i.test(last[1]));
    const continues = short && /^[a-zà-ÿ0-9(«"]/.test(nextWord(i + 1));
    if (ends && !continues) {
      out.push(current.trim());
      current = "";
    } else current += " ";
  }
  if (current.trim()) out.push(current.trim());
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}
/** Composizione semplice senza AI: frasi con la maiuscola iniziale e il punto finale, un paragrafo per riga degli appunti. */
export function composeWithoutAi(notes: string): string {
  return notes
    .split(/\n\s*\n/)
    .map((block) =>
      splitSentences(block)
        .map((s) => {
          const t = s.charAt(0).toLocaleUpperCase("it") + s.slice(1);
          return /[.!?…]$/.test(t) ? t : t + ".";
        })
        .join(" "),
    )
    .filter(Boolean)
    .join("\n\n");
}
/** Versione breve senza AI: le prime frasi del corpo, una per riga, al massimo 5 righe. */
export function shortWithoutAi(body: string, lines = 5): string {
  return splitSentences(body)
    .slice(0, lines)
    .map((s) => (s.split(/\s+/).length > 20 ? s.split(/\s+/).slice(0, 20).join(" ") + "…" : s))
    .join("\n");
}

export type ComposeDraft = { number: number; date: Date; recipients: string; subject: string; body: string; short?: string };
/** Testo completo: intestazione, numero, luogo e data, destinatari, oggetto, corpo, versione breve e firma. */
export function composeText(config: ComposeConfig, draft: ComposeDraft): string {
  return [
    config.header.join("\n"),
    `${config.documentName} n. ${draft.number}/${draft.date.getFullYear()}\n${config.place}, ${dateInWords(draft.date)}`,
    draft.recipients.trim() || config.recipients,
    `Oggetto: ${draft.subject.trim() || "[oggetto]"}`,
    draft.body.trim() || "[testo]",
    ...(draft.short?.trim() ? [`Versione breve:\n${draft.short.trim()}`] : []),
    config.signature,
  ].join("\n\n");
}

/** Controlli sul testo: date impossibili e «[DA VERIFICARE]» bloccano; sigle e frasi lunghe sono avvisi. */
export function composeIssues(text: string, config: Pick<ComposeConfig, "header" | "signature" | "documentName" | "maxWords">): ComposeIssue[] {
  const issues: ComposeIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: ComposeIssue) => {
    const key = issue.level + issue.message;
    if (seen.has(key)) return;
    issues.push(issue);
    seen.add(key);
  };
  // Date in cifre: 31/4, 30/02/2027, 31-04-2026, 31.4.2026 (giorno e mese plausibili come data).
  for (const m of text.matchAll(/(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d/-]|\.\d)/g)) {
    const day = Number(m[1]);
    const month = Number(m[3]);
    // Con punto o trattino serve l'anno: «30.2 euro» o «31.9 metri» non sono date.
    if (m[2] !== "/" && !m[4]) continue;
    if (month < 1 || month > 12 || day > 39) continue;
    if (day < 1 || day > daysIn(month, fullYear(m[4])))
      add({ level: "error", match: m[0], message: `Data impossibile: «${m[0]}». Correggila prima di emettere.` });
  }
  // Date in lettere: 31 aprile, 30 febbraio 2027.
  const monthNames = months.join("|");
  for (const m of text.matchAll(new RegExp(String.raw`\b(\d{1,2})\s+(${monthNames})(?:\s+(\d{4}))?\b`, "gi"))) {
    const day = Number(m[1]);
    const month = months.indexOf(m[2].toLowerCase()) + 1;
    if (day < 1 || day > daysIn(month, m[3] ? Number(m[3]) : undefined))
      add({ level: "error", match: m[0], message: `Data impossibile: «${m[0]}». Correggila prima di emettere.` });
  }
  // La nota dell'assistente può avere forme diverse: «[DA VERIFICARE]», «[31/4 DA VERIFICARE]», «[fine aprile, DA VERIFICARE]».
  if (/DA\s+VERIFICARE/i.test(text))
    add({ level: "error", match: "[DA VERIFICARE]", message: "Il testo contiene «DA VERIFICARE»: controlla il dato e togli la nota prima di emettere." });
  // Sigle e abbreviazioni: parole tutte maiuscole da 2 a 6 lettere (non quelle di intestazione e firma)
  // e forme con il punto come «mod.», «resp.», «D.Lgs.».
  const fixed = new Set(
    [...config.header, config.signature, config.documentName, "Oggetto"].flatMap((l) => l.split(/[^A-Za-zÀ-ÿ]+/)).filter(Boolean).map((w) => w.toUpperCase()),
  );
  const found: string[] = [];
  for (const m of text.matchAll(new RegExp(String.raw`(?<!${word})((?:${word}{1,6}\.){2,}|${word}{1,9}\.)(?=\s*(\S?))`, "g"))) {
    const token = m[1];
    const bare = token.slice(0, -1).toLowerCase();
    const next = m[2] ?? "";
    // «n. 267» nelle norme citate per esteso è ammesso.
    if (bare === "n" && /\d/.test(next)) continue;
    const dotted = (token.match(/\./g) ?? []).length > 1;
    if (dotted || abbreviation.has(bare)) found.push(token);
  }
  for (const m of text.replace(/DA\s+VERIFICARE/gi, " ").matchAll(new RegExp(String.raw`(?<!${word})([A-ZÀ-Ö]{2,6})(?!${word})`, "g")))
    if (!fixed.has(m[1]) && !/^[IVXLCDM]+$/.test(m[1])) found.push(m[1]);
  for (const token of [...new Set(found)])
    add({ level: "warning", match: token, message: `Sigla o abbreviazione da scrivere per esteso: «${token}».` });
  // L'assistente sostituisce i nomi di persona con «Persona A»: avviso, non blocco.
  const placeholder = /\bPersona [A-Z]\b/.exec(text);
  if (placeholder)
    add({ level: "warning", match: placeholder[0], message: "Controlla i nomi: l'assistente ha sostituito un nome con «Persona A» (o simile). Scrivi il nome giusto o togli il riferimento." });
  const max = config.maxWords ?? 25;
  for (const sentence of splitSentences(text)) {
    const words = sentence.split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ0-9]/.test(w)).length;
    if (words > max)
      add({ level: "warning", match: sentence, message: `Frase di ${words} parole (oltre ${max}): «${sentence.split(/\s+/).slice(0, 8).join(" ")}…». Dividila in frasi più brevi.` });
  }
  return issues;
}
export const composeBlocked = (issues: readonly ComposeIssue[]) => issues.some((i) => i.level === "error");

export type ComposeArchiveEntry = { number: number; year: number; date: string; subject: string; recipients: string; text: string };
/** Ricerca per parola nell'archivio (numero, data, oggetto, destinatari e testo), senza accenti né maiuscole. */
export function searchArchive(entries: readonly ComposeArchiveEntry[], query: string): ComposeArchiveEntry[] {
  const f = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = f(query.trim());
  if (!q) return [...entries];
  return entries.filter((e) => f(`${e.number}/${e.year} ${e.date} ${e.subject} ${e.recipients} ${e.text}`).includes(q));
}
