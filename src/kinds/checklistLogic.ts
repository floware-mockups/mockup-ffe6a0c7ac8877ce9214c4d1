// WZ-2126: logica pura del tipo di pagina «Lista di controllo».
// Copia identica in shared/mockupKinds/checklistLogic.ts (anteprima di
// FlowareHub): un test verifica che i due file restino uguali.
// Il controllo automatico cerca parole nel testo, senza distinguere maiuscole:
// nessuna espressione regolare arriva dalla specifica.

export type ChecklistAnswer = "sì" | "no" | "n.p.";
/** Lunghezza massima del testo dell'atto: la stessa che accetta il gateway AI. */
export const checklistTextMaxLength = 8000;
export const checklistAnswers: readonly ChecklistAnswer[] = ["sì", "no", "n.p."];
export const checklistAnswerLabels: Record<ChecklistAnswer, string> = { "sì": "Sì", no: "No", "n.p.": "Non pertinente" };

/** Regola del controllo automatico di una voce. Le parole si cercano senza maiuscole. */
export type ChecklistAutoRule = {
  /** «no» se compare almeno una di queste parole (ha la precedenza). */
  no?: string[];
  /** «sì» se compare almeno una di queste parole. */
  yes?: string[];
  /** «sì» se compaiono tutte queste parole. */
  yesAll?: string[];
  /** «sì» se dopo questo testo c'è un codice di `length` lettere o cifre. */
  codeAfter?: { text: string; length: number };
  /** «sì» se dopo una riga uguale a questo testo c'è un punto numerato «1.». */
  listAfterLine?: string;
  /** «sì» se nel testo c'è una data. */
  date?: boolean;
  /** Note aggiunte quando l'esito è «no» e compare la parola indicata. */
  notes?: { when: string; text: string }[];
  /**
   * «firma»: le parole si cercano solo dove l'atto indica chi lo adotta e lo
   * firma (righe tutte maiuscole come «IL SINDACO» e ultima riga), non nel
   * resto del testo: «sentito il Sindaco» non vale come firma.
   */
  scope?: "firma";
};
export type ChecklistItem = {
  label: string;
  /** Un «no» su questa voce rende l'atto irregolare. */
  critical?: boolean;
  /** Motivo predefinito di un «no» del controllo automatico. */
  hint?: string;
  auto?: ChecklistAutoRule;
};
export type ChecklistDocument = { label: string; title: string; text: string };
export type ChecklistConfig = {
  /** Intestazione in cima alla pagina (norma di riferimento, avvertenze). */
  heading?: string;
  items: ChecklistItem[];
  /** Più di questi «no» rendono l'atto irregolare (predefinito 2). */
  irregularAbove?: number;
  /** Firma della nota finale, per esempio «Il Segretario comunale». */
  signature: string;
  /** Oggetto della nota, prima del titolo dell'atto. */
  noteSubject?: string;
  /** Riferimento normativo citato per esteso nella nota. */
  noteReference?: string;
  /** Documenti di esempio da incollare con un pulsante. */
  documents?: ChecklistDocument[];
};
export type ChecklistResponse = { answer: ChecklistAnswer | ""; note: string };
export type ChecklistOutcome = "regolare" | "regolare con osservazioni" | "irregolare";
export const checklistOutcomeLabels: Record<ChecklistOutcome, string> = {
  regolare: "Regolare",
  "regolare con osservazioni": "Regolare con osservazioni",
  irregolare: "Irregolare",
};

const normalize = (text: string) => text.normalize("NFC").replace(/[’`]/g, "'").toLocaleLowerCase("it");
const has = (text: string, term: string) => normalize(text).includes(normalize(term).trim());
const monthWords = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";
const datePattern = new RegExp(String.raw`\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}\s+(?:${monthWords})\s+\d{4}\b`, "i");

/** Righe della firma: intestazioni tutte maiuscole (chi adotta l'atto) e ultima riga non vuota. */
export function signatureLines(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headings = lines.filter((l) => /\p{Lu}/u.test(l) && l === l.toLocaleUpperCase("it") && !/\d/.test(l));
  return [...headings, lines.at(-1) ?? ""].join("\n");
}
function codeAfter(text: string, rule: { text: string; length: number }) {
  // Posizioni e taglio sullo stesso testo normalizzato (accenti scomposti inclusi).
  const hay = normalize(text);
  const needle = normalize(rule.text).trim();
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const rest = hay.slice(at + needle.length).replace(/^[\s:.,–-]*(?:\([^)]{0,20}\))?[\s:.,–-]*/, "");
    const code = /^[A-Za-z0-9]+/.exec(rest)?.[0] ?? "";
    // Un codice vero ha almeno una cifra: «codice identificativo di gara richiesto» non vale.
    if (code.length === rule.length && /\d/.test(code)) return true;
  }
  return false;
}
function listAfterLine(text: string, line: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const bare = (l: string) => normalize(l).replace(/[\s:.]+$/, "").trim();
  const at = lines.findIndex((l) => bare(l) === bare(line));
  return at >= 0 && lines.slice(at + 1).some((l) => /^1[.)]\s/.test(l) || l === "1." );
}

/** Esito del controllo automatico di una voce sul testo dell'atto. */
export function autoAnswer(item: ChecklistItem, fullText: string): ChecklistResponse {
  const rule = item.auto;
  if (!rule) return { answer: "", note: "" };
  const text = rule.scope === "firma" ? signatureLines(fullText) : fullText;
  const noNote = () => {
    const notes = (rule.notes ?? []).filter((n) => has(text, n.when)).map((n) => n.text);
    return notes.length ? notes.join(" ") : item.hint ?? "";
  };
  if (rule.no?.some((t) => has(text, t))) return { answer: "no", note: noNote() };
  const yes =
    !!rule.yes?.some((t) => has(text, t)) ||
    (!!rule.yesAll?.length && rule.yesAll.every((t) => has(text, t))) ||
    (!!rule.codeAfter && codeAfter(text, rule.codeAfter)) ||
    (!!rule.listAfterLine && listAfterLine(text, rule.listAfterLine)) ||
    (!!rule.date && datePattern.test(text));
  return yes ? { answer: "sì", note: "" } : { answer: "no", note: noNote() };
}
export function autoAnswers(config: ChecklistConfig, text: string): ChecklistResponse[] {
  return config.items.map((item) => autoAnswer(item, text));
}

/**
 * Risposta dell'intelligenza artificiale: valida solo se è un elenco con una
 * risposta per voce. Altrimenti null, e si usa il controllo automatico.
 */
export function parseAiAnswers(value: unknown, count: number): ChecklistResponse[] | null {
  if (!Array.isArray(value) || value.length !== count) return null;
  const out: ChecklistResponse[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const raw = String(Reflect.get(entry, "v") ?? "").trim().toLocaleLowerCase("it");
    const answer: ChecklistAnswer | null = raw === "sì" || raw === "si" ? "sì" : raw === "no" ? "no" : raw === "n.p." || raw === "np" || raw === "non pertinente" ? "n.p." : null;
    if (!answer) return null;
    const note = String(Reflect.get(entry, "note") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    out.push({ answer, note });
  }
  return out;
}

export type ChecklistSummary = {
  complete: boolean;
  noCount: number;
  passed: number;
  relevant: number;
  outcome: ChecklistOutcome | null;
};
/** Esito: irregolare con un «no» su una voce critica o con troppi «no»; con osservazioni con almeno un «no». */
export function checklistSummary(config: ChecklistConfig, responses: readonly ChecklistResponse[]): ChecklistSummary {
  const answers = config.items.map((_, i) => responses[i]?.answer ?? "");
  const complete = answers.every((a) => a !== "");
  const noCount = answers.filter((a) => a === "no").length;
  const passed = answers.filter((a) => a === "sì").length;
  const relevant = answers.filter((a) => a !== "n.p.").length;
  const limit = config.irregularAbove ?? 2;
  const criticalNo = config.items.some((item, i) => item.critical && answers[i] === "no");
  const outcome: ChecklistOutcome | null = !complete
    ? null
    : criticalNo || noCount > limit
      ? "irregolare"
      : noCount > 0
        ? "regolare con osservazioni"
        : "regolare";
  return { complete, noCount, passed, relevant, outcome };
}

const feminine = /^(legge|deliberazione|delibera|determinazione|determina|direttiva|circolare|disposizione|norma|ordinanza|costituzione|convenzione)\b/i;
/**
 * «di» con l'articolo giusto davanti al riferimento normativo: «dell'articolo»,
 * «del decreto», «della legge», «dello statuto». Per i riferimenti che non si
 * riconoscono si scrive «di quanto previsto da …».
 */
export function articulatedDi(reference: string): string {
  const ref = reference.trim();
  const first = ref.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it");
  if (/^[aeiou]/.test(first)) return `dell'${ref}`;
  if (feminine.test(first)) return `della ${ref}`;
  if (/^(s[^aeiou]|z|gn|ps|x|y)/.test(first)) return `dello ${ref}`;
  if (/^[a-z]/.test(first)) return `del ${ref}`;
  return `di quanto previsto da ${ref}`;
}
/** Nota al responsabile, con oggetto, richiamo della norma, esito, voci non superate e firma. */
export function checklistNote(config: ChecklistConfig, act: string, responses: readonly ChecklistResponse[]): string {
  const summary = checklistSummary(config, responses);
  const title = act.trim() || "atto senza titolo";
  const subject = config.noteSubject?.trim() || "esito del controllo successivo di regolarità amministrativa";
  const lines = [`Oggetto: ${subject} – ${title}`, ""];
  const reference = config.noteReference?.trim();
  lines.push(
    reference
      ? `Ai sensi ${articulatedDi(reference)}, è stato svolto il controllo sull'atto «${title}».`
      : `È stato svolto il controllo sull'atto «${title}».`,
  );
  if (!summary.outcome) {
    lines.push("Il controllo non è ancora completo: mancano alcune risposte.");
  } else {
    lines.push(`Esito: ${checklistOutcomeLabels[summary.outcome].toLocaleLowerCase("it")}.`);
    lines.push(`Voci superate: ${summary.passed} su ${summary.relevant} pertinenti.`);
  }
  const failed = config.items
    .map((item, i) => ({ item, response: responses[i] }))
    .filter((x) => x.response?.answer === "no");
  lines.push("");
  if (failed.length) {
    lines.push("Voci non superate:");
    for (const { item, response } of failed) lines.push(`- ${item.label}${response.note.trim() ? `: ${response.note.trim()}` : "."}`);
    lines.push("", "Si chiede di tenere conto di queste osservazioni e di comunicare le azioni correttive.");
  } else if (summary.outcome) {
    lines.push("Non sono emerse irregolarità.");
  }
  lines.push("", config.signature.trim());
  return lines.join("\n");
}

export type ChecklistRecord = { date: string; act: string; outcome: ChecklistOutcome; noCount: number };
