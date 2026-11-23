// WZ-2126 (livello 4): pagina «Documento da modello». Componente identico nel
// template pubblicato e nell'anteprima di FlowareHub (copia in shared/mockupKinds/).
// Colori dai token --mk-* del tema. Dati solo in memoria, per la sessione.
import { useEffect, useMemo, useState } from "react";
import {
  documentAiFields,
  documentBlocked,
  documentIssues,
  documentSummary,
  documentText,
  formatEuro,
  initialDocumentValues,
  type DocumentConfig,
  type DocumentValues,
} from "./documentLogic";
import { kindAiNotice, kindAiUnavailable, kindFileName, kindHtmlDocument, type KindWriter } from "./kindTools";
import { copyText, downloadText, loadKindState, saveKindState } from "./storage";

const card = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) shadow-sm";
const input = "w-full min-w-0 rounded-md border border-(--mk-border) bg-(--mk-surface) px-3 py-2";
const primary = "rounded-lg bg-(--mk-primary) px-4 py-2 font-medium text-(--mk-on-primary) disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-lg border border-(--mk-border) px-4 py-2 font-medium disabled:opacity-50";

type Saved = { values: DocumentValues; number: number | null; nextNumber: number };
const savedOf = (raw: unknown): Saved | null => {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Saved;
  if (!s.values || typeof s.values !== "object" || typeof s.nextNumber !== "number" || !(s.number === null || typeof s.number === "number")) return null;
  const values = Object.fromEntries(Object.entries(s.values).filter(([, v]) => typeof v === "string"));
  return { values, number: s.number, nextNumber: s.nextNumber };
};

export function DocumentKind({
  page,
  config,
  writer,
  storageKey,
  inert = false,
  today = new Date(),
}: {
  page: { id: string };
  config: DocumentConfig;
  writer?: KindWriter;
  /** Memoria facoltativa del browser (storage.ts); senza, i dati restano in memoria. */
  storageKey?: string;
  inert?: boolean;
  today?: Date;
}) {
  const pageId = page.id;
  const disabled = inert;
  const fresh = (): Saved => ({ values: initialDocumentValues(config), number: null, nextNumber: 1 });
  const [state, setState] = useState<Saved>(() => savedOf(loadKindState(storageKey, "document")) ?? fresh());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  useEffect(() => {
    saveKindState(storageKey, "document", state);
  }, [storageKey, state]);
  const { values, number } = state;
  const issues = useMemo(() => documentIssues(config, values), [config, values]);
  const blocked = documentBlocked(issues);
  const summary = documentSummary(config, values);
  const year = today.getFullYear();
  // Il testo si ricalcola a ogni modifica: importi e lettere restano sempre allineati ai dati.
  const text = number === null ? "" : documentText(config, values, { number, year });
  const set = (key: string, value: string) => setState((s) => ({ ...s, values: { ...s.values, [key]: value } }));
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const title = `${config.generateLabel?.replace(/^Genera\s+(la|il|l')\s*/i, "") || "documento"} ${number ?? ""}/${year}`.trim();
  const aiField = config.fields.find((f) => f.ai);
  const writeWithAi = async () => {
    if (!writer || !aiField) return;
    setBusy(true);
    setMessage("L'assistente sta scrivendo…");
    const result = await writer("motivazione", documentAiFields(config, values));
    setBusy(false);
    if (result) {
      set(aiField.key, result);
      setAiUsed(true);
      setMessage(`${aiField.label}: testo scritto dall'assistente. ${kindAiNotice}`);
    } else setMessage(`${kindAiUnavailable} Puoi scrivere il testo a mano oppure lasciare il campo vuoto: si usa il testo predefinito.`);
  };
  return (
    <div className="my-8 grid gap-6" data-kind="document">
      {config.examples && config.examples.length > 0 && (
        <section aria-label="Pratiche di esempio" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Pratiche di esempio:</span>
          {config.examples.map((example) => (
            <button
              key={example.label}
              type="button"
              disabled={disabled}
              className={secondary}
              onClick={() => {
                setState((s) => ({ ...s, values: initialDocumentValues(config, example.values) }));
                setAiUsed(false);
                setMessage(`Pratica «${example.label}» caricata.`);
              }}
            >
              {example.label}
            </button>
          ))}
        </section>
      )}
      <section className={`${card} p-5`}>
        <h3 className="mb-4 font-semibold">Dati del documento</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {config.fields.map((f) => {
            const id = `doc-${pageId}-${f.key}`;
            const label = `${f.label}${f.required ? " *" : ""}`;
            const fieldIssue = issues.find((i) => i.field === f.key && i.level === "error");
            const common = {
              id,
              disabled,
              value: values[f.key] ?? "",
              "aria-invalid": fieldIssue ? true : undefined,
              className: `${input} ${fieldIssue ? "border-(--mk-danger)" : ""}`,
            };
            return (
              <div key={f.key} className={`grid content-start gap-2 text-sm ${f.type === "long" ? "sm:col-span-2" : ""}`}>
                <label htmlFor={id} className="font-medium">
                  {label}
                </label>
                {f.type === "choice" ? (
                  <select {...common} onChange={(e) => set(f.key, e.target.value)}>
                    <option value="">Scegli…</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : f.type === "long" ? (
                  <textarea {...common} rows={4} maxLength={2000} onChange={(e) => set(f.key, e.target.value)} />
                ) : (
                  <input
                    {...common}
                    autoComplete="off"
                    maxLength={200}
                    inputMode={f.type === "number" || f.type === "percent" ? "decimal" : f.digits ? "numeric" : undefined}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
                {f.type === "long" && f.fallback && (
                  <span className="text-(--mk-muted)">
                    Se lo lasci vuoto si usa il testo predefinito.
                    {writer && f.ai && (
                      <>
                        {" "}
                        <button type="button" disabled={disabled || busy} className="font-medium text-(--mk-primary) underline-offset-2 hover:underline" onClick={writeWithAi}>
                          {busy ? "Scrittura in corso…" : "Scrivila con l'assistente AI"}
                        </button>
                      </>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Controlli" className={`${card} p-5`}>
          <h3 className="mb-3 font-semibold">Controlli</h3>
          {issues.length === 0 && <p className="text-sm font-medium">✓ Nessun errore: puoi generare il documento.</p>}
          <ul className="grid gap-2 text-sm">
            {errors.map((i) => (
              <li key={i.message} data-level="error" className="rounded-md border-l-4 border-(--mk-danger) bg-(--mk-subtle) px-3 py-2">
                <strong>Errore:</strong> {i.message}
              </li>
            ))}
            {warnings.map((i) => (
              <li key={i.message} data-level="warning" className="rounded-md border-l-4 border-[#d97706] bg-(--mk-subtle) px-3 py-2">
                <strong>Avviso:</strong> {i.message}
              </li>
            ))}
          </ul>
        </section>
        {config.summary && (
          <section aria-label="Riepilogo" className={`${card} p-5`}>
            <h3 className="mb-3 font-semibold">Riepilogo</h3>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-(--mk-muted)">Netto dopo lo sconto{summary?.discount ? ` del ${String(summary.discount).replace(".", ",")}%` : ""}</dt>
                <dd data-testid="doc-net">{summary ? formatEuro(summary.net) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-(--mk-muted)">IVA al {summary?.vatRate ?? config.summary.vat ?? 22}%</dt>
                <dd data-testid="doc-vat">{summary ? formatEuro(summary.vat) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 font-semibold">
                <dt>Totale</dt>
                <dd data-testid="doc-total">{summary ? formatEuro(summary.total) : "—"}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-(--mk-muted)">Totale in lettere</dt>
                <dd data-testid="doc-words" className="font-medium [overflow-wrap:anywhere]">
                  {summary ? summary.totalInWords : "—"}
                </dd>
              </div>
            </dl>
          </section>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={primary}
          disabled={disabled || blocked}
          onClick={() => {
            setState((s) => ({ ...s, number: s.nextNumber, nextNumber: s.nextNumber + 1 }));
            setMessage("Documento generato: se cambi un dato, il testo si aggiorna da solo.");
          }}
        >
          {config.generateLabel ?? "Genera il documento"}
        </button>
        {blocked && <span className="text-sm text-(--mk-muted)">Il pulsante si attiva quando non ci sono più errori.</span>}
      </div>
      {number !== null && (
        <section aria-label="Documento generato" className={`${card} p-5`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">Testo del documento</h3>
            <div className="flex flex-wrap gap-2 text-sm">
              <button
                type="button"
                className={secondary}
                disabled={disabled || blocked}
                onClick={async () => {
                  const ok = await copyText(text);
                  setCopyFallback(!ok);
                  setMessage(ok ? "Testo copiato." : "Il browser non permette di copiare: seleziona il testo qui sotto e copialo.");
                }}
              >
                Copia testo
              </button>
              <button
                type="button"
                className={secondary}
                disabled={disabled || blocked}
                onClick={async () => {
                  const ok = downloadText(kindFileName(title, "html"), kindHtmlDocument(title, text), "text/html;charset=utf-8");
                  setMessage(ok ? "File scaricato: si apre con Word o con il browser." : "Download non riuscito: usa «Copia testo».");
                }}
              >
                Scarica (apribile con Word)
              </button>
            </div>
          </div>
          {blocked && (
            <p role="alert" className="mb-3 rounded-md border-l-4 border-(--mk-danger) bg-(--mk-subtle) px-3 py-2 text-sm">
              Dopo l'ultima modifica ci sono errori: correggili prima di usare il testo.
            </p>
          )}
          {aiUsed && <p className="mb-3 text-sm text-(--mk-muted)">{kindAiNotice}</p>}
          {copyFallback ? (
            <textarea readOnly aria-label="Testo da copiare" value={text} rows={16} className={`${input} w-full font-mono text-sm`} />
          ) : (
            <pre data-testid="doc-text" className="whitespace-pre-wrap rounded-md bg-(--mk-subtle) p-4 font-[inherit] text-sm leading-relaxed">
              {text}
            </pre>
          )}
        </section>
      )}
      <p role="status" className="text-sm text-(--mk-muted)">
        {message}
      </p>
    </div>
  );
}
