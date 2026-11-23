// WZ-2126 (livello 3): pagina «Testo da appunti». Componente identico nel
// template pubblicato e nell'anteprima di FlowareHub (copia in shared/mockupKinds/).
// Il corpo lo scrive l'assistente AI (se il prototipo lo collega) oppure la
// composizione semplice. Archivio e numerazione solo in memoria, per la sessione.
import { useEffect, useMemo, useState } from "react";
import {
  composeBlocked,
  composeIssues,
  composeText,
  composeWithoutAi,
  dateInWords,
  searchArchive,
  shortWithoutAi,
  type ComposeArchiveEntry,
  type ComposeConfig,
} from "./composeLogic";
import { kindAiNotice, kindAiUnavailable, kindNoAiNotice, type KindWriter } from "./kindTools";
import { copyText, loadKindState, saveKindState } from "./storage";

const card = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) shadow-sm";
const input = "w-full min-w-0 rounded-md border border-(--mk-border) bg-(--mk-surface) px-3 py-2";
const primary = "rounded-lg bg-(--mk-primary) px-4 py-2 font-medium text-(--mk-on-primary) disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-lg border border-(--mk-border) px-4 py-2 font-medium disabled:opacity-50";

type Saved = {
  subject: string;
  recipients: string;
  tone: string;
  notes: string;
  text: string;
  mode: "ai" | "simple" | null;
  archive: ComposeArchiveEntry[];
  nextNumber: number;
};
const savedOf = (raw: unknown, fallback: Saved): Saved | null => {
  if (!raw || typeof raw !== "object") return null;
  const s = { ...fallback, ...(raw as Partial<Saved>) };
  const strings = [s.subject, s.recipients, s.tone, s.notes, s.text].every((v) => typeof v === "string");
  if (!strings || !Array.isArray(s.archive) || typeof s.nextNumber !== "number") return null;
  return { ...s, archive: s.archive.filter((e) => e && typeof e.text === "string" && typeof e.number === "number").slice(0, 200) };
};

export function ComposeKind({
  config,
  writer,
  storageKey,
  inert = false,
  today = new Date(),
}: {
  config: ComposeConfig;
  writer?: KindWriter;
  /** Memoria facoltativa del browser (storage.ts); senza, archivio e numerazione restano in memoria. */
  storageKey?: string;
  inert?: boolean;
  today?: Date;
}) {
  const disabled = inert;
  const fresh = (): Saved => ({
    subject: "",
    recipients: config.recipients,
    tone: config.tones[0] ?? "formale",
    notes: "",
    text: "",
    mode: null,
    archive: [],
    nextNumber: config.firstNumber ?? 1,
  });
  const [state, setState] = useState<Saved>(() => savedOf(loadKindState(storageKey, "compose"), fresh()) ?? fresh());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"" | "body" | "short">("");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<ComposeArchiveEntry | null>(null);
  useEffect(() => {
    saveKindState(storageKey, "compose", state);
  }, [storageKey, state]);
  const patch = (p: Partial<Saved>) => setState((s) => ({ ...s, ...p }));
  const issues = useMemo(() => (state.text ? composeIssues(state.text, config) : []), [state.text, config]);
  const blocked = composeBlocked(issues);
  const year = today.getFullYear();
  const draft = (body: string, short?: string) =>
    composeText(config, { number: state.nextNumber, date: today, recipients: state.recipients, subject: state.subject, body, short });

  const writeBody = async () => {
    if (!state.notes.trim()) {
      setMessage("Scrivi prima gli appunti, oppure carica l'appunto di esempio.");
      return;
    }
    if (writer) {
      setBusy("body");
      setMessage("L'assistente sta scrivendo…");
      const result = await writer("circolare", { tono: state.tone, oggetto: state.subject, destinatari: state.recipients, appunti: state.notes });
      setBusy("");
      if (result) {
        patch({ text: draft(result), mode: "ai" });
        setMessage(`Testo scritto dall'assistente. ${kindAiNotice}`);
        return;
      }
      patch({ text: draft(composeWithoutAi(state.notes)), mode: "simple" });
      setMessage(`${kindAiUnavailable} Testo composto senza intelligenza artificiale: rileggilo e correggilo.`);
      return;
    }
    patch({ text: draft(composeWithoutAi(state.notes)), mode: "simple" });
    setMessage(kindNoAiNotice);
  };
  // La versione breve va prima della firma; quella vecchia, se c'è, viene sostituita.
  const withShort = (text: string, short: string) => {
    const base = text.replace(/\n\nVersione breve:\n[\s\S]*?(?=\n\n[^\n]*$)/, "");
    const signature = `\n\n${config.signature}`;
    const block = `\n\nVersione breve:\n${short.trim()}`;
    return base.endsWith(signature) ? base.slice(0, -signature.length) + block + signature : base + block;
  };
  const bodyOf = (text: string) => {
    const at = text.indexOf("Oggetto:");
    const afterSubject = at >= 0 ? text.slice(text.indexOf("\n\n", at) + 2) : text;
    return afterSubject.replace(/\n\nVersione breve:[\s\S]*$/, "").replace(new RegExp(`\\n\\n${config.signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "");
  };
  const writeShort = async () => {
    if (!state.text) return;
    if (writer) {
      setBusy("short");
      setMessage("L'assistente sta riassumendo…");
      const result = await writer("versione_breve", { circolare: bodyOf(state.text) });
      setBusy("");
      if (result) {
        // Sullo stato di adesso: le modifiche fatte a mano durante l'attesa restano.
        const short = result.split("\n").filter((l) => l.trim()).slice(0, 5).join("\n");
        setState((s) => (s.text ? { ...s, text: withShort(s.text, short) } : s));
        setMessage(`Versione breve aggiunta in fondo. ${kindAiNotice}`);
        return;
      }
      setMessage(`${kindAiUnavailable} Versione breve composta senza intelligenza artificiale: sono le prime frasi del testo.`);
    } else setMessage("Versione breve composta senza intelligenza artificiale: sono le prime frasi del testo, rileggila.");
    setState((s) => (s.text ? { ...s, text: withShort(s.text, shortWithoutAi(bodyOf(s.text))) } : s));
  };
  const results = searchArchive(state.archive, query);
  return (
    <div className="my-8 grid gap-6" data-kind="compose">
      <section className={`${card} p-5`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Dati · {config.documentName}</h3>
          {config.example && (
            <button
              type="button"
              className={secondary}
              disabled={disabled}
              onClick={() => {
                const e = config.example!;
                patch({ subject: e.subject, notes: e.notes, recipients: e.recipients ?? config.recipients, tone: e.tone ?? state.tone });
                setMessage("Appunto di esempio caricato.");
              }}
            >
              Carica un appunto di esempio
            </button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Oggetto</span>
            <input className={input} disabled={disabled} maxLength={200} value={state.subject} onChange={(e) => patch({ subject: e.target.value })} />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Destinatari</span>
            <input className={input} disabled={disabled} maxLength={200} value={state.recipients} onChange={(e) => patch({ recipients: e.target.value })} />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Tono</span>
            <select className={input} disabled={disabled} value={state.tone} onChange={(e) => patch({ tone: e.target.value })}>
              {config.tones.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm sm:col-span-2">
            <span className="font-medium">Appunti</span>
            <textarea className={input} disabled={disabled} rows={4} maxLength={2000} value={state.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={primary} disabled={disabled || busy !== ""} onClick={writeBody}>
            {busy === "body" ? "Scrittura in corso…" : "Scrivi il testo"}
          </button>
          <span className="text-sm text-(--mk-muted)">
            {writer ? "Il testo lo scrive l'assistente AI; se non risponde, si compone senza." : "Versione senza intelligenza artificiale: composizione semplice degli appunti."}
          </span>
        </div>
      </section>
      {state.text && (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <section aria-label="Anteprima" className={`${card} p-5`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">Anteprima (modificabile)</h3>
              <span className="text-xs text-(--mk-muted)">{state.mode === "ai" ? "Scritta dall'assistente AI" : "Versione senza AI"}</span>
            </div>
            {state.mode === "simple" && <p className="mb-3 text-sm text-(--mk-muted)">{kindNoAiNotice}</p>}
            <textarea
              aria-label="Testo da emettere"
              className={`${input} w-full text-sm leading-relaxed`}
              disabled={disabled}
              rows={18}
              maxLength={8000}
              value={state.text}
              onChange={(e) => patch({ text: e.target.value })}
            />
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <button type="button" className={secondary} disabled={disabled || busy !== ""} onClick={writeShort}>
                {busy === "short" ? "Riassunto in corso…" : "Versione breve (5 righe)"}
              </button>
              <button
                type="button"
                className={secondary}
                disabled={disabled}
                onClick={async () => setMessage((await copyText(state.text)) ? "Testo copiato." : "Il browser non permette di copiare: seleziona il testo e copialo.")}
              >
                Copia testo
              </button>
              <button
                type="button"
                className={primary}
                disabled={disabled || blocked || busy !== ""}
                onClick={() => {
                  const entry: ComposeArchiveEntry = {
                    number: state.nextNumber,
                    year,
                    date: dateInWords(today),
                    subject: state.subject.trim() || "(senza oggetto)",
                    recipients: state.recipients.trim() || config.recipients,
                    text: state.text,
                  };
                  setState((s) => ({ ...s, archive: [entry, ...s.archive], nextNumber: s.nextNumber + 1, text: "", mode: null, notes: "", subject: "" }));
                  setMessage(`Emesso e archiviato: ${config.documentName} n. ${entry.number}/${entry.year}.`);
                }}
              >
                Emetti e archivia
              </button>
            </div>
          </section>
          <section aria-label="Controlli automatici" className={`${card} p-5`}>
            <h3 className="mb-3 font-semibold">Controlli automatici</h3>
            {issues.length === 0 && <p className="text-sm font-medium">✓ Nessun problema trovato.</p>}
            {blocked && <p className="mb-2 text-sm">L'emissione è bloccata finché ci sono errori.</p>}
            <ul className="grid gap-2 text-sm">
              {issues.map((i) => (
                <li
                  key={i.level + i.message}
                  data-level={i.level}
                  className={`rounded-md border-l-4 bg-(--mk-subtle) px-3 py-2 ${i.level === "error" ? "border-(--mk-danger)" : "border-[#d97706]"}`}
                >
                  <strong>{i.level === "error" ? "Errore:" : "Avviso:"}</strong> {i.message}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <section aria-label="Archivio" className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--mk-divider) p-5">
          <h3 className="font-semibold">Archivio · {state.archive.length}</h3>
          <label className="flex items-center gap-2 text-sm">
            Cerca
            <input className={`${input} sm:w-64`} aria-label="Cerca nell'archivio" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Parola, numero, oggetto" />
          </label>
        </div>
        {results.length === 0 ? (
          <p className="p-5 text-sm text-(--mk-muted)">{state.archive.length ? "Nessun risultato." : "Ancora nessun testo emesso in questa sessione."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-(--mk-subtle)">
                <tr>
                  <th className="px-5 py-3">Numero</th>
                  <th className="px-5 py-3">Data</th>
                  <th className="px-5 py-3">Oggetto</th>
                  <th className="px-5 py-3">Destinatari</th>
                  <th className="px-5 py-3">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {results.map((e) => (
                  <tr key={`${e.number}/${e.year}`} className="border-t border-(--mk-divider)">
                    <td className="px-5 py-3">
                      {e.number}/{e.year}
                    </td>
                    <td className="px-5 py-3">{e.date}</td>
                    <td className="px-5 py-3">{e.subject}</td>
                    <td className="px-5 py-3">{e.recipients}</td>
                    <td className="px-5 py-3">
                      <button type="button" className="font-medium text-(--mk-primary)" onClick={() => setOpened(e)}>
                        Apri
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {opened && (
          <div className="border-t border-(--mk-divider) p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="font-semibold">
                {config.documentName} n. {opened.number}/{opened.year}
              </h4>
              <button type="button" className={secondary} onClick={() => setOpened(null)}>
                Chiudi
              </button>
            </div>
            <pre className="whitespace-pre-wrap rounded-md bg-(--mk-subtle) p-4 font-[inherit] text-sm leading-relaxed">{opened.text}</pre>
          </div>
        )}
      </section>
      <p role="status" className="text-sm text-(--mk-muted)">
        {message}
      </p>
    </div>
  );
}
