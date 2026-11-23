// Pannello «Assistente» del template v6 (docs/mockup-ai-agent.md §2.2): un solo
// componente per tutti i mockup, guidato dal manifesto del gateway.
// Percorsi guidati, campo libero, documenti di esempio e caricamento, passi
// visibili, risultati concreti (Excel, Word, PDF, KPI, grafici).
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { mockupAgentDocumentContentTypes, mockupAgentMessages, mockupAgentPolicy, type MockupAgentManifest } from "./contract";
import { formatEuro, formatPct, formatSignedPct, isNormattivaUrl, type AgentTable } from "./compute";
import { agentGatewayOrigin } from "./boot";
import { createGatewayClient, type GatewayClient } from "./gateway";
import { createAgentRuntime, loadManifest, offlineNotice, pickDemoManifest, type AgentRuntime, type Citation, type RunState, type Workspace } from "./runtime";
import { AgentSteps } from "./steps";
import { MonthlyChart } from "./charts";
import { determinaModel, determinaPdfLines, reportPdfLines, type DocModel } from "./document";
import { tablePdf, textPdf } from "./pdf";
import { downloadBlob, downloadDocx, downloadWorkbook, fileName } from "./files";
import { reconOutcomeLabels, signedEuro } from "./reconcile";
import seed from "../spec.json";
import "./agent.css";

// «offline»: il manifesto non arriva dopo i tentativi, oppure il gateway lo
// dichiara non disponibile (manifesto fallito); restano i percorsi dimostrativi
// locali del caso (demo.json), tutti «esempio preparato». Nessun vicolo cieco:
// senza un caso affine si usa il primo caso, dichiarato come esempio generico.
// «Riprova» richiede di nuovo il manifesto: su un manifesto fallito il gateway
// ne avvia la rigenerazione (con tetto anti-abuso) e risponde «pending».
type Phase = "loading" | "no-token" | "pending" | "unavailable" | "expired" | "ready" | "offline";
type Message = { role: "user" | "agent"; text: string; citations?: Citation[]; prepared?: boolean; local?: boolean; tone?: "error"; suggest?: { pathId: string; prepared?: boolean } };
export type AgentBridge = {
  /** Mostra un record (etichetta → valore) nella tabella del prototipo. */
  onRecord?: (record: Record<string, string>) => string | void;
  /** KPI calcolati dall'agente da mostrare nelle card del prototipo. */
  onMetrics?: (metrics: { label: string; value: string }[]) => void;
};

const gatewayOrigin = agentGatewayOrigin;

const button = "rounded-lg px-3 py-2 text-sm font-medium";
const primary = `${button} bg-(--mk-primary) text-(--mk-on-primary) disabled:opacity-60`;
const secondary = `${button} border border-(--mk-border) bg-(--mk-surface) hover:bg-(--mk-subtle) disabled:opacity-60`;
const box = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) p-3";

export function AgentPanel({ token, bridge, client: injected }: { token: string | null; bridge?: AgentBridge; client?: GatewayClient }) {
  const client = useMemo<GatewayClient | null>(() => injected ?? (token && gatewayOrigin ? createGatewayClient({ origin: gatewayOrigin, token }) : null), [injected, token]);
  const [phase, setPhase] = useState<Phase>(client ? "loading" : "no-token");
  const [open, setOpen] = useState(false);
  const [manifest, setManifest] = useState<MockupAgentManifest | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [run, setRun] = useState<RunState>({ pathId: null, steps: [], running: false });
  const [ws, setWs] = useState<Workspace | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<"determina" | "report" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [genericDemo, setGenericDemo] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const runtime = useRef<AgentRuntime | null>(null);
  const remainingRef = useRef<number | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Quando parte un percorso i passi tornano in vista; i messaggi nuovi pure.
  useEffect(() => { if (run.running) stepsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [run.running, run.pathId]);
  const runningRef = useRef(false);
  useEffect(() => { runningRef.current = run.running; }, [run.running]);
  useEffect(() => { if (messages.length && !runningRef.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length]);
  const say = (m: Message) => setMessages((list) => [...list, m].slice(-30));

  // Manifesto: una richiesta all'avvio; se «pending» riprova ogni 5 s per 3 minuti.
  // Su un errore con `fallback: true` (rete, 5xx, 429, timeout) altri 3 tentativi
  // con backoff e jitter; poi il pannello minimo con i percorsi dimostrativi locali.
  useEffect(() => {
    if (!client) return;
    let stopped = false;
    const start = (m: MockupAgentManifest, live: boolean) => {
      setManifest(m);
      runtime.current = createAgentRuntime({ manifest: m, client: live ? client : null, minStepMs: 450, remaining: live ? remainingRef.current : null, onChange: (r, w) => { setRun(r); setWs(w); } });
      setRun(runtime.current.run);
      setWs(runtime.current.workspace);
      setMessages([]);
      setPhase(live ? "ready" : "offline");
    };
    const offline = async () => {
      let demo: MockupAgentManifest | null = null, generic = false;
      try {
        const cases = (await import("./demo.json")).default.cases as unknown as { manifest: MockupAgentManifest }[];
        demo = pickDemoManifest(seed as { title?: string; description?: string; pages?: { title?: string }[] }, cases as never);
        if (!demo && cases[0]) { demo = cases[0].manifest; generic = true; }
      } catch { demo = null; }
      if (stopped) return;
      setGenericDemo(generic);
      if (demo) start(demo, false);
      else { runtime.current = null; setManifest(null); setWs(null); setPhase("offline"); }
    };
    setPhase("loading");
    void loadManifest(client, {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      stopped: () => stopped,
      onPending: () => setPhase("pending"),
    }).then(async (outcome) => {
      if (outcome.kind === "ready") { remainingRef.current = outcome.remaining; setRemaining(outcome.remaining); start(outcome.manifest, true); }
      else if (outcome.kind === "offline" || outcome.kind === "unavailable") await offline();
      else if (outcome.kind !== "stopped") setPhase(outcome.kind);
    }).catch(() => { if (!stopped) void offline(); });
    return () => { stopped = true; };
  }, [client, attempt]);

  // Apertura: il fuoco va sul titolo del pannello; Esc chiude e torna al pulsante.
  useEffect(() => {
    if (!open) return;
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /** Download con errore visibile accanto ai pulsanti: nessuna promise senza catch. */
  const download = async (what: string, make: () => unknown) => {
    setDownloadError(null);
    try { await make(); } catch { setDownloadError(`Non riesco a preparare ${what}: riprova tra qualche istante.`); }
  };

  // I KPI calcolati compaiono anche nelle card del prototipo.
  const kpis = ws?.kpis;
  useEffect(() => {
    if (kpis?.length) bridge?.onMetrics?.(kpis.filter((k) => k.raw !== null).map((k) => ({ label: k.label, value: k.value })));
  }, [kpis, bridge]);

  // Stampa: il contenuto va in un nodo dedicato, poi «Salva come PDF» del browser.
  useEffect(() => {
    if (!printing) return;
    document.documentElement.dataset.mkPrint = printing;
    const done = () => { delete document.documentElement.dataset.mkPrint; setPrinting(null); };
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 60);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]);

  // Nella pagina propria: stampa del browser («Salva come PDF», con il grafico).
  // Dentro l'iframe di FlowareHub la sandbox blocca print(): si scarica un PDF di testo.
  const savePdf = (kind: "determina" | "report") => {
    if (window.self === window.top) return setPrinting(kind);
    if (!ws || !manifest) return;
    const title = manifest.agent.name.replace(/^Assistente\s*/i, "Report ");
    const lines = kind === "determina" && doc ? determinaPdfLines(doc) : reportPdfLines(ws, title);
    const name = kind === "determina" && doc ? doc.subject.replace(/^OGGETTO:\s*/, "Determina ") : title;
    void download("il PDF", () => downloadBlob(textPdf(lines, "Prototipo Floware · dati inventati"), fileName(name, "pdf"), "application/pdf"));
  };
  const startPath = async (pathId: string, prepared = false) => {
    const rt = runtime.current, path = manifest?.paths.find((p) => p.id === pathId);
    if (!rt || !path || run.running) return;
    say({ role: "agent", text: `Avvio «${path.label}».`, prepared });
    await rt.runPath(pathId);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const rt = runtime.current, text = draft.trim();
    if (!rt || !text || busy) return;
    setDraft("");
    say({ role: "user", text });
    setBusy(true);
    try {
      const outcome = await rt.ask(text);
      if (outcome.kind === "path") await startPath(outcome.pathId, outcome.prepared);
      else if (outcome.kind === "answer") say({ role: "agent", text: outcome.text, citations: outcome.citations, prepared: false, local: outcome.local, suggest: outcome.suggest });
      else say({ role: "agent", text: outcome.text, suggest: outcome.suggest, prepared: outcome.suggest?.prepared, ...(outcome.error ? { tone: "error" as const } : {}) });
    } finally { setBusy(false); }
  };

  const sendDocument = async (bytes: Uint8Array | ArrayBuffer, type: string, name: string, sampleId?: string) => {
    const rt = runtime.current;
    if (!rt || !client || phase !== "ready") return false;
    setBusy(true);
    say({ role: "agent", text: `Ricevo «${name}» e controllo che non contenga dati personali…` });
    try {
      const result = await client.document({ bytes, type, name });
      if (result.ok && "documentId" in result.data) {
        rt.useDocument(result.data.documentId, name, sampleId);
        say({ role: "agent", text: `Documento ricevuto: ${result.data.pages} ${result.data.pages === 1 ? "pagina" : "pagine"}. Controllo privacy superato: nessun dato personale.` });
        return true;
      }
      if (result.ok && "rejected" in result.data) say({ role: "agent", tone: "error", text: result.data.message });
      else if (!result.ok && result.status === 429) say({ role: "agent", tone: "error", text: result.message ?? "Hai caricato tutti i documenti disponibili: usa il documento di esempio." });
      else say({ role: "agent", tone: "error", text: (!result.ok && result.message) || "Non riesco a leggere il documento adesso: proseguo con il documento di esempio." });
      return false;
    } finally { setBusy(false); }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > mockupAgentPolicy.documentMaxBytes) return say({ role: "agent", tone: "error", text: mockupAgentMessages.tooLarge });
    const type = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "");
    if (!mockupAgentDocumentContentTypes[type]) return say({ role: "agent", tone: "error", text: mockupAgentMessages.unsupported });
    await sendDocument(await file.arrayBuffer(), type, file.name);
  };

  const samplePdf = (id: string) => {
    const doc = manifest?.sampleDocuments.find((d) => d.id === id);
    return doc?.table ? tablePdf(doc.title, "Comune di Esempio · prospetto dimostrativo con dati inventati", doc.table) : null;
  };
  const pickSample = async (id: string) => {
    const rt = runtime.current, doc = manifest?.sampleDocuments.find((d) => d.id === id);
    if (!rt || !doc) return;
    rt.useSample(id);
    if (doc.table && doc.kind === "prospetto") {
      const pdf = samplePdf(id);
      // Il PDF di esempio passa davvero dal gateway; se non risponde resta la tabella del manifesto.
      if (pdf && phase === "ready") await sendDocument(pdf, "application/pdf", fileName(doc.title, "pdf"), id);
      else say({ role: "agent", text: `Uso la tabella di «${doc.title}».`, prepared: phase !== "ready" });
    } else say({ role: "agent", text: `Uso «${doc.title}».` });
  };

  if (!gatewayOrigin && !injected) return null;
  const today = Date.now();
  const doc: DocModel | null = manifest && ws && ws.files.includes("docx") ? determinaModel(manifest, ws, today) : null;
  const report = !!ws && (ws.files.includes("xlsx") || !!ws.kpis || !!ws.chart || !!ws.comparison || !!ws.reconciliation);
  const usable = (phase === "ready" || phase === "offline") && !!manifest && !!ws;
  const retry = (
    <button type="button" data-testid="agent-retry" disabled={run.running} className={`${secondary} mt-2`} onClick={() => setAttempt((n) => n + 1)}>Riprova</button>
  );

  return (
    <>
      <button
        type="button"
        ref={toggleRef}
        data-testid="agent-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`mk-no-print fixed right-4 top-4 z-30 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg ${open ? "border border-(--mk-border) bg-(--mk-surface) text-(--mk-text)" : "bg-(--mk-primary) text-(--mk-on-primary)"}`}
      >
        <span aria-hidden="true">✦</span> {open ? "Chiudi" : "Assistente"}
      </button>
      {open && (
        <aside
          aria-label="Assistente del prototipo"
          data-testid="agent-panel"
          className="mk-no-print fixed inset-y-0 right-0 z-20 flex w-full max-w-[30rem] flex-col border-l border-(--mk-divider) bg-(--mk-bg) text-(--mk-text) shadow-2xl"
        >
          <header className="border-b border-(--mk-divider) bg-(--mk-surface) px-5 pb-4 pt-5 pr-32">
            <p className="text-xs font-semibold uppercase tracking-widest text-(--mk-primary)">Assistente AI · dati di esempio</p>
            <h2 ref={titleRef} tabIndex={-1} className="mt-1 text-lg font-bold outline-none">{manifest?.agent.name ?? "Assistente"}</h2>
            {manifest && <p className="text-sm text-(--mk-muted)">{manifest.agent.role}</p>}
          </header>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {phase === "no-token" && <p className={box}>{mockupAgentMessages.noToken}</p>}
            {phase === "expired" && <p className={box}>{mockupAgentMessages.expired}</p>}
            {phase === "loading" && <p className={box}>Preparo l'assistente…</p>}
            {phase === "pending" && <p className={box}>L'assistente di questo prototipo si sta preparando: ancora qualche istante.</p>}
            {phase === "unavailable" && <div className={box}><p>{mockupAgentMessages.unavailable}</p>{retry}</div>}
            {phase === "offline" && (
              <div role="status" data-testid="agent-offline" className="rounded-lg border border-(--mk-border) bg-(--mk-subtle) p-3 text-sm">
                <p>{offlineNotice}{manifest ? (genericDemo ? ": percorso dimostrativo generico, non specifico di questo prototipo." : "") : ": per questo prototipo non c'è un percorso dimostrativo."}</p>
                {retry}
              </div>
            )}
            {usable && manifest && ws && (
              <>
                <p className="text-sm">{manifest.agent.greeting}</p>
                <section aria-label="Percorsi guidati" className="grid gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-(--mk-muted)">Percorsi guidati</h3>
                  <div className="flex flex-wrap gap-2">
                    {manifest.paths.map((p) => (
                      <button key={p.id} type="button" disabled={run.running} onClick={() => void startPath(p.id)} className={run.pathId === p.id ? primary : secondary}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </section>
                {manifest.sampleDocuments.length > 0 && (
                  <section aria-label="Documenti" className="grid gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-(--mk-muted)">Documenti</h3>
                    {manifest.sampleDocuments.map((d) => (
                      <div key={d.id} className={`${box} flex flex-wrap items-center justify-between gap-2`}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{d.title}</p>
                          <p className="text-xs text-(--mk-muted)">Esempio con dati inventati{ws.sampleDocumentId === d.id ? " · in uso" : ""}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={busy || run.running} className={secondary} onClick={() => void pickSample(d.id)}>
                            {d.kind === "modello" ? "Usa il modello di esempio" : d.kind === "prospetto" ? "Importa il PDF di esempio" : "Usa la tabella di esempio"}
                          </button>
                          {d.kind === "prospetto" && d.table && (
                            <button type="button" className={secondary} onClick={() => void download("il PDF di esempio", () => { const pdf = samplePdf(d.id); if (pdf) downloadBlob(pdf, fileName(d.title, "pdf"), "application/pdf"); })}>
                              Scarica il PDF di esempio
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {phase === "ready" && <div className="flex flex-wrap items-center gap-2">
                      <button type="button" disabled={busy || run.running} className={secondary} onClick={() => upload.current?.click()}>Carica un documento</button>
                      <span className="text-xs text-(--mk-muted)">PDF, Word, Excel, CSV · max 5 MB · senza dati personali</span>
                      <input ref={upload} type="file" hidden accept=".pdf,.docx,.xlsx,.csv,.txt" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
                    </div>}
                  </section>
                )}
                {manifest.variables.length > 0 && <Variables manifest={manifest} ws={ws} runtime={runtime.current} bridge={bridge} say={say} />}
                <div ref={stepsRef} className="grid scroll-mt-4 gap-2" aria-live="polite">
                  {ws.notice && <p role="status" data-testid="agent-notice" className="rounded-lg border border-(--mk-border) bg-(--mk-subtle) p-3 text-sm">{ws.notice}</p>}
                  <AgentSteps steps={run.steps} />
                </div>
                {ws.table && <TablePreview table={ws.table} source={ws.tableSource} />}
                {ws.comparison && <Comparison ws={ws} />}
                {ws.reconciliation && <ReconciliationView ws={ws} />}
                {ws.kpis && (
                  <section aria-label="Indicatori" className="grid grid-cols-2 gap-2" data-testid="agent-kpis">
                    {ws.kpis.map((k) => (
                      <div key={k.id} className={`${box} min-w-0`}>
                        <p className="text-xs text-(--mk-muted) [overflow-wrap:break-word] [text-wrap:balance]">{k.label}</p>
                        {/* Valore breve e mai tagliato: si va a capo fra le parole, la spiegazione sta sotto in piccolo. */}
                        <p className={`mt-1 font-semibold [overflow-wrap:break-word] ${k.value.length > 14 ? "text-base" : "text-lg"}`}>{k.value}</p>
                        {k.note && <p className="text-xs text-(--mk-muted) [overflow-wrap:break-word]">{k.note}</p>}
                      </div>
                    ))}
                  </section>
                )}
                {ws.chart && <div className={box}><MonthlyChart {...ws.chart} /></div>}
                {ws.draft && !doc && <Commentary draft={ws.draft} />}
                {doc && <DocPreview doc={doc} />}
                {(report || doc) && (
                  <section aria-label="Scarica" className="flex flex-wrap gap-2" data-testid="agent-downloads">
                    {doc && <button type="button" className={primary} onClick={() => void download("il Word", () => downloadDocx(doc, fileName(doc.subject.replace(/^OGGETTO:\s*/, "Determina "), "docx")))}>Scarica Word</button>}
                    {doc && <button type="button" className={secondary} onClick={() => savePdf("determina")}>Salva come PDF</button>}
                    {ws.table && ws.files.includes("xlsx") && (
                      <button type="button" className={doc ? secondary : primary} onClick={() => void download("l'Excel", () => downloadWorkbook({ manifest, workspace: ws, dataSheet: ws.sheet ?? "Dati" }, fileName(manifest.agent.name.replace(/^Assistente\s*/i, "") || "dati", "xlsx")))}>
                        Scarica Excel
                      </button>
                    )}
                    {!doc && report && <button type="button" className={secondary} onClick={() => savePdf("report")}>Salva come PDF</button>}
                    {downloadError && <p role="alert" data-testid="agent-download-error" className="w-full text-sm text-(--mk-danger)">{downloadError}</p>}
                  </section>
                )}
                {messages.length > 0 && (
                  <section aria-label="Conversazione" className="grid gap-2" aria-live="polite">
                    {messages.map((m, i) => (
                      <div key={i} className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "justify-self-end bg-(--mk-primary) text-(--mk-on-primary)" : m.tone === "error" ? "border border-(--mk-danger) bg-(--mk-surface)" : "bg-(--mk-surface) border border-(--mk-divider)"}`}>
                        <p>{m.text}</p>
                        {m.citations?.filter((c) => isNormattivaUrl(c.url)).map((c) => <a key={c.itemKey} className="mt-1 block text-xs underline" href={c.url} target="_blank" rel="noreferrer noopener">{c.citation}</a>)}
                        {m.prepared && <span className="mt-1 inline-block rounded-full border border-(--mk-border) px-2 py-0.5 text-xs">esempio preparato</span>}
                        {m.local && <span data-testid="agent-local" className="mt-1 inline-block rounded-full border border-(--mk-border) px-2 py-0.5 text-xs">calcolato sui dati caricati</span>}
                        {m.suggest && manifest.paths.some((p) => p.id === m.suggest!.pathId) && (
                          <button type="button" data-testid="agent-suggest" disabled={busy || run.running} className={`${secondary} mt-2 block`} onClick={() => void startPath(m.suggest!.pathId, m.suggest!.prepared)}>
                            Avvia «{manifest.paths.find((p) => p.id === m.suggest!.pathId)!.label}»
                          </button>
                        )}
                      </div>
                    ))}
                  </section>
                )}
                <div ref={endRef} />
              </>
            )}
          </div>
          {usable && (
            <form onSubmit={(e) => void submit(e)} className="flex gap-2 border-t border-(--mk-divider) bg-(--mk-surface) p-3">
              <label className="sr-only" htmlFor="mk-agent-input">Scrivi all'assistente</label>
              <input
                id="mk-agent-input"
                value={draft}
                maxLength={mockupAgentPolicy.messageMaxLength}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Chiedi qualcosa sui dati o su un percorso…"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-(--mk-border) bg-(--mk-surface) px-3 py-2 text-sm"
              />
              <button type="submit" disabled={busy || run.running || !draft.trim()} className={primary}>Invia</button>
            </form>
          )}
          {(ws?.remaining ?? remaining) !== null && phase === "ready" && <p data-testid="agent-remaining" className="bg-(--mk-surface) px-3 pb-2 text-right text-xs text-(--mk-muted)">Risposte dal vivo disponibili: {ws?.remaining ?? remaining}</p>}
        </aside>
      )}
      {printing && createPortal(
        <div className="mk-print-root">
          {printing === "determina" && doc ? <DocPreview doc={doc} print /> : ws ? <PrintReport ws={ws} title={manifest?.agent.name ?? "Report"} /> : null}
        </div>,
        document.body,
      )}
    </>
  );
}

function Variables({ manifest, ws, runtime, bridge, say }: { manifest: MockupAgentManifest; ws: Workspace; runtime: AgentRuntime | null; bridge?: AgentBridge; say: (m: Message) => void }) {
  const field = "rounded-md border border-(--mk-border) bg-(--mk-surface) px-2 py-1.5 text-sm";
  return (
    <details className={box} open>
      <summary className="cursor-pointer text-sm font-semibold">Dati variabili</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {manifest.variables.map((v) => (
          <label key={v.key} className="grid gap-1 text-xs text-(--mk-muted)">
            {v.label}
            {v.type === "scelta" && v.options?.length ? (
              <select className={field} value={ws.variables[v.key] ?? ""} onChange={(e) => runtime?.setVariables({ [v.key]: e.target.value })}>
                {v.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input className={field} value={ws.variables[v.key] ?? ""} maxLength={160} inputMode={v.type === "importo" ? "decimal" : undefined} onChange={(e) => runtime?.setVariables({ [v.key]: e.target.value })} />
            )}
          </label>
        ))}
      </div>
      {bridge?.onRecord && (
        <button
          type="button"
          className={`${secondary} mt-3`}
          onClick={() => {
            const record = Object.fromEntries(manifest.variables.map((v) => [v.label, ws.variables[v.key] ?? ""]));
            const where = bridge.onRecord?.(record);
            say({ role: "agent", text: where ? `Ho aggiunto l'esempio nella schermata «${where}».` : "Nessuna schermata del prototipo ha colonne corrispondenti a questi dati." });
          }}
        >
          Mostra nella Dashboard
        </button>
      )}
    </details>
  );
}

function TablePreview({ table, source }: { table: AgentTable; source?: string }) {
  // La tabella estratta compare man mano, riga per riga.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const step = Math.max(1, Math.ceil(table.rows.length / 14));
    const timer = setInterval(() => setShown((n) => { const next = Math.min(table.rows.length, n + step); if (next >= table.rows.length) clearInterval(timer); return next; }), 90);
    return () => clearInterval(timer);
  }, [table]);
  return (
    <section aria-label="Tabella dei dati" className={`${box} overflow-hidden p-0`} data-testid="agent-table">
      <p className="flex justify-between border-b border-(--mk-divider) px-3 py-2 text-xs text-(--mk-muted)">
        <span>{source ?? "Dati"}</span>
        <span>{Math.min(shown, table.rows.length)} / {table.rows.length} righe</span>
      </p>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-(--mk-subtle)">
            <tr>{table.columns.map((c) => <th key={c} className="px-2 py-1.5 font-semibold">{c}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.slice(0, shown).map((r, i) => (
              <tr key={i} className="mk-row-in border-t border-(--mk-divider)">{r.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Comparison({ ws, print }: { ws: Workspace; print?: boolean }) {
  const c = ws.comparison!;
  return (
    <section aria-label="Confronto" className={box} data-testid="agent-comparison">
      <h3 className="text-sm font-semibold">Confronto{c.compareColumn ? ` con «${c.compareColumn}»` : ""}</h3>
      {c.anomalies.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-sm">
          {c.anomalies.slice(0, 5).map((a, i) => (
            <li key={`${i}-${a.label}`} className="flex justify-between gap-2"><span className="font-medium">{a.label}</span><span className="text-right text-(--mk-danger)">{a.reason}</span></li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-(--mk-muted)">Nessuna anomalia oltre le soglie.</p>}
      <details className="mt-2 text-xs" open={print}>
        <summary className="cursor-pointer text-(--mk-muted)">Tutte le righe ({c.rows.length})</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr><th>Voce</th><th className="text-right">{c.column}</th>{c.compareColumn && <th className="text-right">Δ %</th>}{c.baseColumn && <th className="text-right">Capacità</th>}</tr></thead>
          <tbody>
            {c.rows.map((r, i) => (
              <tr key={`${i}-${r.label}`} className="border-t border-(--mk-divider)">
                <td className="py-1">{r.label}</td>
                <td className="text-right">{formatEuro(r.value)}</td>
                {c.compareColumn && <td className="text-right">{r.delta === null ? "—" : formatSignedPct(r.delta)}</td>}
                {c.baseColumn && <td className="text-right">{r.capacity === null ? "—" : formatPct(r.capacity)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

/** Confronto riga per riga fra movimenti e importi attesi: prima le righe da guardare. */
function ReconciliationView({ ws, print }: { ws: Workspace; print?: boolean }) {
  const r = ws.reconciliation!;
  const issues = r.rows.filter((x) => x.outcome !== "abbinato");
  const tone = (o: string) => (o === "abbinato" ? "text-(--mk-muted)" : "text-(--mk-danger)");
  return (
    <section aria-label="Riconciliazione" className={box} data-testid="agent-reconciliation">
      <h3 className="text-sm font-semibold">Riconciliazione: «{r.actual.title}» con «{r.expected.title}»</h3>
      <p className="mt-1 text-xs text-(--mk-muted)">Atteso {formatEuro(r.totals.expected)} · rilevato {formatEuro(r.totals.actual)} · differenza {signedEuro(r.totals.difference)}</p>
      {issues.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-sm">
          {issues.slice(0, 6).map((x) => (
            <li key={x.id} className="flex justify-between gap-2">
              <span className="min-w-0 font-medium [overflow-wrap:break-word]">{[x.key, x.description].filter(Boolean).join(" · ")}</span>
              <span className="shrink-0 text-right text-(--mk-danger)">{reconOutcomeLabels[x.outcome]}{x.outcome === "mancante" ? ` ${formatEuro(x.expected ?? 0)}` : ` ${signedEuro(x.difference)}`}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-(--mk-muted)">Tutti gli importi attesi sono abbinati.</p>}
      <details className="mt-2 text-xs" open={print}>
        <summary className="cursor-pointer text-(--mk-muted)">Tutte le righe ({r.rows.length})</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr><th>Voce</th><th className="text-right">Atteso</th><th className="text-right">Rilevato</th><th className="text-right">Esito</th></tr></thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.id} className="border-t border-(--mk-divider)">
                <td className="py-1">{[x.key, x.description].filter(Boolean).join(" · ")}</td>
                <td className="text-right">{x.expected === null ? "—" : formatEuro(x.expected)}</td>
                <td className="text-right">{formatEuro(x.actual)}{x.movements > 1 ? ` (${x.movements})` : ""}</td>
                <td className={`text-right ${tone(x.outcome)}`}>{reconOutcomeLabels[x.outcome]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function Commentary({ draft }: { draft: NonNullable<Workspace["draft"]> }) {
  return (
    <section aria-label="Commento" className={box}>
      {draft.title && <h3 className="text-sm font-semibold">{draft.title}</h3>}
      {draft.sections.map((s, i) => (
        <div key={i} className="mt-2 text-sm">
          <p className="font-medium">{s.heading}</p>
          {s.paragraphs.map((p, j) => <p key={j} className="mt-1 text-(--mk-muted)">{p}</p>)}
        </div>
      ))}
    </section>
  );
}

function DocPreview({ doc, print }: { doc: DocModel; print?: boolean }) {
  return (
    <article aria-label="Anteprima della determinazione" data-testid="agent-document" className={print ? "mk-doc" : `${box} mk-doc max-h-[28rem] overflow-y-auto text-sm leading-relaxed`}>
      {doc.header.map((h, i) => <p key={i} className={`text-center ${i === 0 ? "font-bold tracking-wide" : "text-xs text-(--mk-muted)"}`}>{h}</p>)}
      <p className="mt-3 text-center font-bold">{doc.title}</p>
      <p className="mt-3 font-semibold">{doc.subject}</p>
      {doc.blocks.map((b, i) => (
        <div key={i} className="mt-3">
          {b.heading && <p className={`mb-1 font-semibold ${b.heading === b.heading.toUpperCase() ? "text-center" : ""}`}>{b.heading}</p>}
          {b.list ? <ul className="list-disc space-y-1 pl-5">{b.paragraphs.map((p, j) => <li key={j}>{p}</li>)}</ul> : b.paragraphs.map((p, j) => <p key={j} className="mt-1 text-justify">{p}</p>)}
        </div>
      ))}
      {doc.notes.length > 0 && (
        <div className="mt-4 border-t border-(--mk-divider) pt-2 text-xs">
          <p className="font-semibold">Note e riferimenti normativi</p>
          {doc.notes.map((n, i) => <p key={i}>[{i + 1}] {n.citation}{isNormattivaUrl(n.url) && <> — <a className="underline" href={n.url} target="_blank" rel="noreferrer noopener">Normattiva</a></>}{n.verified ? ` (verificato il ${n.verified})` : ""}</p>)}
        </div>
      )}
      <p className="mt-4 text-xs italic text-(--mk-muted)">{doc.footer}</p>
    </article>
  );
}

function PrintReport({ ws, title }: { ws: Workspace; title: string }) {
  return (
    <article className="mk-doc">
      <h1 className="text-xl font-bold">{title.replace(/^Assistente\s*/i, "Report ")}</h1>
      <p className="text-xs">Comune di Esempio · dati inventati per una dimostrazione</p>
      {ws.kpis && <div className="mt-4 grid grid-cols-2 gap-2">{ws.kpis.map((k) => <div key={k.id} className="border p-2"><p className="text-xs">{k.label}</p><p className="font-semibold">{k.value}</p>{k.note && <p className="text-xs">{k.note}</p>}</div>)}</div>}
      {ws.chart && <div className="mt-4"><MonthlyChart {...ws.chart} /></div>}
      {ws.comparison && <div className="mt-4"><Comparison ws={ws} print /></div>}
      {ws.reconciliation && <div className="mt-4"><ReconciliationView ws={ws} print /></div>}
      {ws.draft && <div className="mt-4"><Commentary draft={ws.draft} /></div>}
    </article>
  );
}
