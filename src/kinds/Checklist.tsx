// WZ-2126: tipo di pagina «Lista di controllo» (livello 5 di Rovigo, ma
// generico: verifiche, controlli, sopralluoghi). Voci, regole dell'esito,
// controllo automatico, firma e documenti di esempio vengono dalla specifica
// (`page.checklist`). «Proponi le risposte» usa l'assistente AI del prototipo
// se c'è, altrimenti il controllo automatico a parole chiave.
// Copia identica in shared/mockupKinds/Checklist.tsx (anteprima di FlowareHub).
import { useRef, useState } from "react";
import {
  autoAnswers,
  checklistAnswerLabels,
  checklistAnswers,
  checklistNote,
  checklistOutcomeLabels,
  checklistSummary,
  checklistTextMaxLength,
  parseAiAnswers,
  type ChecklistConfig,
  type ChecklistOutcome,
  type ChecklistRecord,
  type ChecklistResponse,
} from "./checklistLogic";
import { formatItalianDate, todayIso } from "./deadlinesLogic";
import { copyText, loadKindState, saveKindState } from "./storage";

/** Revisione con l'AI: restituisce l'elenco grezzo `[{v, note}]` oppure null se non disponibile. */
export type ChecklistReview = (request: { items: string[]; text: string }) => Promise<unknown | null>;

const card = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) shadow-sm";
const field = "w-full min-w-0 rounded-md border border-(--mk-border) bg-(--mk-surface) px-3 py-2";
const primary = "rounded-lg bg-(--mk-primary) px-4 py-2 font-medium text-(--mk-on-primary) disabled:opacity-60";
const secondary = "rounded-lg border border-(--mk-border) px-3 py-2 text-sm font-medium";
const outcomeStyle: Record<ChecklistOutcome, string> = {
  regolare: "bg-emerald-100 text-emerald-900 border-emerald-300",
  "regolare con osservazioni": "bg-amber-100 text-amber-900 border-amber-300",
  irregolare: "bg-red-100 text-red-900 border-red-300",
};
/** Migliaia con il punto, come si scrive in italiano (8.000). */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const blank = (count: number): ChecklistResponse[] => Array.from({ length: count }, () => ({ answer: "", note: "" }));
const validRecords = (value: unknown): ChecklistRecord[] =>
  Array.isArray(value)
    ? value.filter((r): r is ChecklistRecord => !!r && typeof r === "object" && typeof r.date === "string" && typeof r.act === "string" && typeof r.outcome === "string" && Object.hasOwn(checklistOutcomeLabels, r.outcome) && typeof r.noCount === "number").slice(0, 50)
    : [];

export function Checklist({ page, config, review, storageKey, inert = false }: { page: { id: string }; config: ChecklistConfig; review?: ChecklistReview; storageKey?: string; inert?: boolean }) {
  const [act, setAct] = useState("");
  const [text, setText] = useState("");
  const [responses, setResponses] = useState(() => blank(config.items.length));
  const [mode, setMode] = useState("");
  const [busy, setBusy] = useState(false);
  // Ogni proposta ha un numero: una risposta arrivata dopo un cambio di atto si scarta.
  const request = useRef(0);
  const [message, setMessage] = useState("");
  const [manualCopy, setManualCopy] = useState(false);
  // Lo storico si legge all'apertura e si scrive solo quando si registra un controllo.
  const [history, setHistory] = useState<ChecklistRecord[]>(() => validRecords(loadKindState(storageKey, "history")));
  const summary = checklistSummary(config, responses);
  const note = checklistNote(config, act, responses);
  const say = (t: string) => {
    setMessage(t);
    setManualCopy(false);
  };
  const setOne = (i: number, patch: Partial<ChecklistResponse>) =>
    setResponses(responses.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const propose = async () => {
    if (!text.trim()) return say("Incolla prima il testo dell'atto o scegli un esempio.");
    const ticket = ++request.current;
    setBusy(true);
    let proposed: ChecklistResponse[] | null = null;
    if (review) {
      setMode("Sto chiedendo all'intelligenza artificiale…");
      try {
        proposed = parseAiAnswers(await review({ items: config.items.map((i) => i.label), text }), config.items.length);
      } catch {
        proposed = null;
      }
    }
    if (ticket !== request.current) return;
    if (proposed) setMode("Risposte proposte dall'intelligenza artificiale. Può sbagliare: verifica ogni voce prima di registrare.");
    else {
      proposed = autoAnswers(config, text);
      setMode(
        review
          ? "L'intelligenza artificiale non ha risposto: risposte proposte dal controllo automatico a parole chiave. Verifica ogni voce."
          : "Risposte proposte dal controllo automatico a parole chiave (intelligenza artificiale non disponibile). Verifica ogni voce.",
      );
    }
    setResponses(proposed);
    setBusy(false);
    say("");
  };
  const loadDocument = (i: number) => {
    const doc = config.documents?.[i];
    if (!doc) return;
    request.current++;
    setBusy(false);
    setAct(doc.title);
    setText(doc.text);
    setResponses(blank(config.items.length));
    setMode("");
    say(`Caricato l'esempio «${doc.label}». Ora premi «Proponi le risposte».`);
  };
  const copyNote = async () => {
    if (await copyText(note)) say("Nota copiata negli appunti.");
    else {
      setMessage("Il browser non permette la copia automatica: seleziona il testo della nota e copialo.");
      setManualCopy(true);
    }
  };
  const record = () => {
    if (!summary.outcome) return say("Rispondi a tutte le voci prima di registrare il controllo.");
    const entry: ChecklistRecord = { date: todayIso(), act: act.trim() || "atto senza titolo", outcome: summary.outcome, noCount: summary.noCount };
    const next = [entry, ...history].slice(0, 50);
    setHistory(next);
    saveKindState(storageKey, "history", next);
    say(`Controllo registrato: ${entry.act}, ${checklistOutcomeLabels[entry.outcome].toLocaleLowerCase("it")}.`);
  };

  return (
    <div className="mt-8 grid gap-6" data-kind="checklist">
      {config.heading && <p className="rounded-lg border border-(--mk-divider) bg-(--mk-subtle) p-4 text-sm">{config.heading}</p>}

      <section className={`${card} grid gap-4 p-5`}>
        <h3 className="font-semibold">Atto da controllare</h3>
        {!!config.documents?.length && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Esempi">
            {config.documents.map((doc, i) => (
              <button key={i} type="button" disabled={inert || busy} className={secondary} onClick={() => loadDocument(i)}>
                {doc.label}
              </button>
            ))}
          </div>
        )}
        <label className="grid gap-2 text-sm">
          Numero o titolo dell'atto
          <input disabled={inert || busy} className={field} value={act} maxLength={200} onChange={(e) => setAct(e.target.value)} autoComplete="off" />
        </label>
        <label className="grid gap-2 text-sm">
          Testo dell'atto
          <textarea disabled={inert || busy} className={`${field} min-h-48 font-mono text-xs`} value={text} maxLength={checklistTextMaxLength} onChange={(e) => setText(e.target.value.slice(0, checklistTextMaxLength))} placeholder="Incolla qui il testo (solo dati inventati o già pubblici)." />
          <span className="text-xs text-(--mk-muted)">
            {thousands(text.length)} di {thousands(checklistTextMaxLength)} caratteri
            {text.length >= checklistTextMaxLength ? ": il testo incollato è stato tagliato, controlla che la fine dell'atto ci sia." : ""}
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={inert || busy} className={primary} onClick={propose}>
            {busy ? "Sto proponendo…" : "Proponi le risposte"}
          </button>
          <span className="text-sm text-(--mk-muted)" aria-live="polite">{mode}</span>
        </div>
      </section>

      <section className={`${card} overflow-hidden`} aria-label="Lista di controllo">
        <ol className="divide-y divide-(--mk-divider)">
          {config.items.map((item, i) => (
            <li key={i} className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-64 flex-1">
                <p className="font-medium">
                  {i + 1}. {item.label}
                  {item.critical && <span className="ml-2 rounded bg-(--mk-subtle) px-1.5 py-0.5 text-xs font-normal text-(--mk-muted)">voce decisiva</span>}
                </p>
                <input
                  disabled={inert}
                  aria-label={`Note sulla voce ${i + 1}`}
                  className={`${field} mt-2 w-full text-sm`}
                  placeholder="Note"
                  maxLength={200}
                  value={responses[i]?.note ?? ""}
                  onChange={(e) => setOne(i, { note: e.target.value })}
                />
              </div>
              <fieldset className="flex flex-wrap items-start gap-2">
                <legend className="sr-only">Risposta alla voce {i + 1}</legend>
                {checklistAnswers.map((a) => (
                  <label key={a} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${responses[i]?.answer === a ? "border-(--mk-primary) bg-(--mk-primary) text-(--mk-on-primary)" : "border-(--mk-border)"}`}>
                    <input type="radio" disabled={inert} className="sr-only" name={`${page.id}-voce-${i}`} checked={responses[i]?.answer === a} onChange={() => setOne(i, { answer: a })} />
                    {checklistAnswerLabels[a]}
                  </label>
                ))}
              </fieldset>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${card} grid gap-4 p-5`}>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold">Esito</h3>
          {summary.outcome ? (
            <span data-testid="checklist-outcome" className={`rounded-full border px-3 py-1 text-sm font-semibold ${outcomeStyle[summary.outcome]}`}>
              {checklistOutcomeLabels[summary.outcome]}
            </span>
          ) : (
            <span data-testid="checklist-outcome" className="text-sm text-(--mk-muted)">Rispondi a tutte le voci per vedere l'esito.</span>
          )}
          <span className="text-sm text-(--mk-muted)">Voci superate {summary.passed} su {summary.relevant} pertinenti</span>
        </div>
        <label className="grid gap-2 text-sm">
          Nota al responsabile
          <textarea readOnly className={`${field} min-h-56 text-sm`} value={note} onFocus={(e) => manualCopy && e.currentTarget.select()} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={inert} className={secondary} onClick={copyNote}>Copia la nota</button>
          <button type="button" disabled={inert} className={primary} onClick={record}>Registra il controllo</button>
        </div>
      </section>

      {history.length > 0 && (
        <section className={`${card} overflow-x-auto`}>
          <h3 className="p-5 pb-3 font-semibold">Controlli registrati</h3>
          <table className="w-full text-left text-sm">
            <thead className="bg-(--mk-subtle)">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Atto</th>
                <th className="px-4 py-3">Esito</th>
                <th className="px-4 py-3">Voci non superate</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} className="border-t border-(--mk-divider)">
                  <td className="px-4 py-3">{formatItalianDate(h.date)}</td>
                  <td className="px-4 py-3">{h.act}</td>
                  <td className="px-4 py-3">{checklistOutcomeLabels[h.outcome]}</td>
                  <td className="px-4 py-3">{h.noCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p role="status" className="text-sm text-(--mk-muted)">{message}</p>
    </div>
  );
}
