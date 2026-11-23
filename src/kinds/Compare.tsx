// WZ-2126 (livello 2): tipo di pagina «Confronto di due file». Si caricano due
// file (.xlsx o .csv) o i dati di esempio con le trappole; la pagina pulisce i
// dati, confronta per chiave e mostra riepilogo, trappole, differenze, totali
// per raggruppamento, grafico, ricerca ed esportazione. I file si leggono solo
// in questo browser: niente rete, niente salvataggio, niente memoria del browser.
// Copia identica in templates/mockup-v1/src/kinds/Compare.tsx (verificata da un test).
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  CompareFileError,
  cleanCompareTable,
  compareCopyText,
  compareFiles,
  compareSampleTables,
  compareSheets,
  compareStatusLabels,
  describeRecognized,
  formatEuro,
  formatPercent,
  searchSubject,
  topGrowth,
  type CompareConfig,
  type CompareRawTable,
  type CompareSide,
  type CompareStatus,
} from "./compareLogic.ts";
import { buildCompareWorkbook, buildSampleWorkbook, copyToClipboard, downloadFile, readCompareFile, xlsxType } from "./compareFiles.ts";

const card = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) shadow-sm";
const field = "rounded-md border border-(--mk-border) bg-(--mk-surface) px-3 py-2";
const primary = "rounded-lg bg-(--mk-primary) px-4 py-2.5 text-sm font-medium text-(--mk-on-primary) disabled:opacity-60";
const secondary = "rounded-lg border border-(--mk-border) bg-(--mk-surface) px-4 py-2.5 text-sm font-medium disabled:opacity-60";
const up = "text-emerald-700";
const down = "text-(--mk-danger)";
const tone = (cents: number) => (cents > 0 ? up : cents < 0 ? down : "");

type Loaded = { name: string; table: CompareRawTable };
type Slots = Record<CompareSide, Loaded | null>;
const fileSlug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "dati";

export function configOfCompare(page: object): CompareConfig | null {
  const config = Reflect.get(page, "compare");
  return config && typeof config === "object" && !Array.isArray(config) ? (config as CompareConfig) : null;
}

export function ComparePage({ page, inert = false }: { page: object; inert?: boolean }) {
  const config = configOfCompare(page);
  const table = { columns: (Reflect.get(page, "columns") as string[]) ?? [], rows: (Reflect.get(page, "rows") as string[][]) ?? [] };
  const [files, setFiles] = useState<Slots>({ before: null, after: null });
  const [errors, setErrors] = useState<Partial<Record<CompareSide, string>>>({});
  const [busy, setBusy] = useState<CompareSide | null>(null);
  const [filter, setFilter] = useState<"all" | CompareStatus>("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const reads = useRef({ before: 0, after: 0 });
  const result = useMemo(() => {
    if (!config || !files.before || !files.after) return null;
    try {
      return compareFiles(files.before.table, files.after.table, config);
    } catch {
      return null;
    }
  }, [config, files]);
  if (!config) return null;
  const f = config.fields;
  const labelOf = (side: CompareSide) => (side === "before" ? config.before : config.after);
  const lower = (text: string) => text.toLocaleLowerCase("it-IT");

  const accept = (side: CompareSide, loaded: Loaded) => {
    try {
      cleanCompareTable(loaded.table, config, side);
      setFiles((current) => ({ ...current, [side]: loaded }));
      setErrors((current) => ({ ...current, [side]: undefined }));
      return true;
    } catch (error) {
      setFiles((current) => ({ ...current, [side]: null }));
      setErrors((current) => ({ ...current, [side]: error instanceof CompareFileError ? error.message : "Il file non si legge." }));
      return false;
    }
  };
  const choose = async (side: CompareSide, event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const ticket = ++reads.current[side];
    setBusy(side);
    setMessage("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await readCompareFile(file.name, bytes);
      if (ticket !== reads.current[side]) return;
      if (accept(side, { name: file.name, table: parsed })) setMessage(`File del ${labelOf(side)} letto in questo browser: ${file.name}`);
    } catch (error) {
      if (ticket !== reads.current[side]) return;
      setFiles((current) => ({ ...current, [side]: null }));
      setErrors((current) => ({ ...current, [side]: error instanceof CompareFileError ? error.message : "Il file non si apre: potrebbe essere danneggiato." }));
    } finally {
      if (ticket === reads.current[side]) setBusy(null);
      input.value = "";
    }
  };
  const useSample = () => {
    const sample = compareSampleTables(table, config);
    reads.current.before++;
    reads.current.after++;
    const ok = accept("before", { name: `Esempio ${config.before}`, table: sample.before }) && accept("after", { name: `Esempio ${config.after}`, table: sample.after });
    setBusy(null);
    setMessage(ok ? "Dati di esempio caricati, con le trappole da trovare." : "I dati di esempio di questa pagina non sono completi.");
  };
  const downloadSample = async (side: CompareSide) => {
    const sample = compareSampleTables(table, config)[side];
    try {
      const data = await buildSampleWorkbook(sample, labelOf(side));
      setMessage(downloadFile(`esempio-${fileSlug(labelOf(side))}.xlsx`, data, xlsxType) ? `Esempio ${labelOf(side)} scaricato: caricalo qui sopra per provarlo.` : "Il browser non permette di scaricare il file.");
    } catch {
      setMessage("Non è stato possibile preparare il file di esempio.");
    }
  };
  const exportExcel = async () => {
    if (!result) return;
    try {
      const data = await buildCompareWorkbook(compareSheets(result, config));
      setMessage(downloadFile(`confronto-${fileSlug(config.before)}-${fileSlug(config.after)}.xlsx`, data, xlsxType) ? "Confronto scaricato in Excel." : "Il browser non permette di scaricare il file: usa «Copia».");
    } catch {
      setMessage("Non è stato possibile preparare il file Excel: usa «Copia».");
    }
  };
  const copy = async () => {
    if (!result) return;
    const text = compareCopyText(result, config);
    if (await copyToClipboard(text)) {
      setManualCopy(null);
      setMessage("Confronto copiato: puoi incollarlo in Excel o in un documento.");
    } else {
      setManualCopy(text);
      setMessage("Il browser non permette di copiare da solo: seleziona il testo qui sotto e copialo.");
    }
  };
  const clear = () => {
    reads.current.before++;
    reads.current.after++;
    setFiles({ before: null, after: null });
    setErrors({});
    setBusy(null);
    setQuery("");
    setManualCopy(null);
    setMessage("Confronto azzerato.");
  };

  const slot = (side: CompareSide, title: string) => {
    const loaded = files[side];
    const cleaned = loaded && result ? result[side] : null;
    return (
      <section className={`${card} grid min-w-0 content-start gap-3 p-5`} aria-label={`File del ${labelOf(side)}`}>
        <h3 className="font-semibold">
          {title} · {labelOf(side)}
        </h3>
        <label className="grid gap-2 text-sm">
          Scegli il file (.xlsx o .csv)
          <input
            type="file"
            accept=".xlsx,.csv,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className={`${field} w-full min-w-0 text-sm`}
            onChange={(event) => void choose(side, event)}
          />
        </label>
        {busy === side && <p className="text-sm text-(--mk-muted)">Lettura del file in corso…</p>}
        {errors[side] && (
          <p role="alert" className={`text-sm font-medium ${down}`}>
            {errors[side]}
          </p>
        )}
        {loaded && !errors[side] && (
          <p className="text-sm text-(--mk-muted)">
            <span className="font-medium text-(--mk-text)">{loaded.name}</span>
            {cleaned && (
              <>
                {" "}
                · {cleaned.read} righe · colonne riconosciute: {describeRecognized(cleaned, config)}
              </>
            )}
          </p>
        )}
        <button type="button" className={`${secondary} justify-self-start`} onClick={() => void downloadSample(side)}>
          Scarica esempio {labelOf(side)}
        </button>
      </section>
    );
  };

  const shown = result ? result.differences.filter((d) => d.status !== "same" && (filter === "all" || d.status === filter)) : [];
  const growth = result ? topGrowth(result) : [];
  const maxGrowth = Math.max(1, ...growth.map((g) => g.diff));
  const found = result ? searchSubject(result, query) : null;
  const metrics = result
    ? [
        { label: "Righe nuove", value: String(result.counts.new) },
        { label: "Righe sparite", value: String(result.counts.removed) },
        { label: "Importi cambiati", value: String(result.counts.changed) },
        { label: `Totale ${config.before}`, value: formatEuro(result.totals.before) },
        { label: `Totale ${config.after}`, value: formatEuro(result.totals.after) },
        { label: "Differenza", value: `${formatEuro(result.totals.diff, true)} (${formatPercent(result.totals.percent)})`, className: tone(result.totals.diff) },
      ]
    : [];
  const groupLabel = f.group ? f.group.label : "";
  const groupPlural = config.groupPlural ?? groupLabel;

  return (
    <fieldset disabled={inert} className="@container mt-8 grid min-w-0 grid-cols-1 gap-6" data-kind="compare">
      {/* Colore del bordo in linea: nell'anteprima di FlowareHub una regola globale sui bordi vincerebbe sulla classe. */}
      <p role="note" className="rounded-xl border-2 bg-(--mk-surface) p-4 text-sm leading-relaxed" style={{ borderColor: "var(--mk-danger)" }}>
        <strong>Usa solo file di prova senza dati veri: il prototipo è pubblico.</strong> I file si leggono solo in questo browser: non vengono
        inviati a nessuno né salvati, e spariscono quando chiudi la pagina.
      </p>
      {/* Colonne secondo la larghezza della pagina, non dello schermo: uguale nel sito e nell'anteprima. */}
      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        {slot("before", "Primo file")}
        {slot("after", "Secondo file")}
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primary} onClick={useSample}>
          Usa i dati di esempio (con trappole)
        </button>
        {(files.before || files.after) && (
          <button type="button" className={secondary} onClick={clear}>
            Ricomincia
          </button>
        )}
      </div>
      {!result && (
        <p className="text-sm text-(--mk-muted)">
          Carica i due file oppure usa i dati di esempio: il confronto per {lower(f.key.label)} compare qui sotto.
        </p>
      )}
      {result && (
        <>
          <section aria-label="Riepilogo del confronto" className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @4xl:grid-cols-3">
            {metrics.map((m) => (
              <div key={m.label} className={`${card} min-w-0 p-5`}>
                <p className="text-sm text-(--mk-muted)">{m.label}</p>
                <p className={`mt-3 font-semibold ${m.value.length > 14 ? "text-xl" : m.value.length > 9 ? "text-2xl" : "text-3xl"} ${m.className ?? ""}`}>{m.value}</p>
              </div>
            ))}
          </section>

          <section aria-label="Trappole trovate" className={`${card} p-5`}>
            <h3 className="mb-3 font-semibold">Trappole trovate · {result.traps.length}</h3>
            {result.traps.length ? (
              <ul className="grid list-disc gap-2 pl-5 text-sm">
                {result.traps.map((t, i) => (
                  <li key={i}>{t.text}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-(--mk-muted)">Nessuna trappola: i due file sono già puliti.</p>
            )}
          </section>

          <section aria-label="Differenze" className={`overflow-hidden ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--mk-divider) p-5">
              <h3 className="font-semibold">Differenze</h3>
              <label className="text-sm">
                Mostra{" "}
                <select className={`ml-2 ${field}`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                  <option value="all">Tutte ({result.counts.new + result.counts.removed + result.counts.changed})</option>
                  <option value="new">Nuove ({result.counts.new})</option>
                  <option value="removed">Sparite ({result.counts.removed})</option>
                  <option value="changed">Cambiate ({result.counts.changed})</option>
                </select>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-(--mk-subtle)">
                  <tr>
                    <th className="px-4 py-3">{f.key.label}</th>
                    {result.has.subject && <th className="px-4 py-3">{f.subject!.label}</th>}
                    {result.has.description && <th className="px-4 py-3">{f.description!.label}</th>}
                    <th className="px-4 py-3">Esito</th>
                    <th className="px-4 py-3 text-right">Prima ({config.before})</th>
                    <th className="px-4 py-3 text-right">Dopo ({config.after})</th>
                    <th className="px-4 py-3 text-right">Differenza</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.key} className="border-t border-(--mk-divider)">
                      <td className="px-4 py-3 font-medium">{d.key}</td>
                      {result.has.subject && <td className="px-4 py-3">{d.subject}</td>}
                      {result.has.description && <td className="px-4 py-3">{d.description}</td>}
                      <td className="px-4 py-3">{compareStatusLabels[d.status]}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{d.before === null ? "—" : formatEuro(d.before)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{d.after === null ? "—" : formatEuro(d.after)}</td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${tone(d.diff)}`}>{formatEuro(d.diff, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && <p className="p-5 text-sm text-(--mk-muted)">Nessuna differenza da mostrare.</p>}
            </div>
          </section>

          {result.has.group && (
            <div className="grid grid-cols-1 gap-6 @6xl:grid-cols-[3fr_2fr]">
              <section aria-label={`Totali per ${lower(groupLabel)}`} className={`overflow-hidden ${card}`}>
                <h3 className="border-b border-(--mk-divider) p-5 font-semibold">Totali per {lower(groupLabel)}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-(--mk-subtle)">
                      <tr>
                        <th className="px-4 py-3">{groupLabel}</th>
                        <th className="px-4 py-3 text-right">{config.before}</th>
                        <th className="px-4 py-3 text-right">{config.after}</th>
                        <th className="px-4 py-3 text-right">Differenza</th>
                        <th className="px-4 py-3 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.groups.map((g) => (
                        <tr key={g.group} className="border-t border-(--mk-divider)">
                          <td className="px-4 py-3 font-medium">{g.group || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">{formatEuro(g.before)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">{formatEuro(g.after)}</td>
                          <td className={`whitespace-nowrap px-4 py-3 text-right ${tone(g.diff)}`}>{formatEuro(g.diff, true)}</td>
                          <td className={`whitespace-nowrap px-4 py-3 text-right ${tone(g.diff)}`}>{g.isNew ? "nuovo" : formatPercent(g.percent)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-(--mk-border) font-semibold">
                        <td className="px-4 py-3">Totale</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">{formatEuro(result.totals.before)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">{formatEuro(result.totals.after)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right ${tone(result.totals.diff)}`}>{formatEuro(result.totals.diff, true)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right ${tone(result.totals.diff)}`}>{formatPercent(result.totals.percent)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
              <section aria-label={`I ${growth.length} ${lower(groupPlural)} cresciuti di più`} className={`${card} p-5`}>
                <h3 className="mb-4 font-semibold">
                  I {growth.length === 5 ? "5" : growth.length} {lower(groupPlural)} cresciuti di più
                </h3>
                {growth.length ? (
                  <div className="grid gap-3">
                    {growth.map((g) => (
                      <div key={g.group} className="grid grid-cols-[5rem_1fr_7.5rem] items-center gap-3 text-sm">
                        <span className="truncate font-medium">{g.group}</span>
                        <span className="h-3 rounded bg-(--mk-subtle)">
                          <span className="block h-3 rounded bg-(--mk-primary)" style={{ width: `${Math.max(4, Math.round((g.diff / maxGrowth) * 100))}%` }} />
                        </span>
                        <span className={`whitespace-nowrap text-right ${up}`}>{formatEuro(g.diff, true)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-(--mk-muted)">Nessun {lower(groupLabel)} è cresciuto.</p>
                )}
              </section>
            </div>
          )}

          {f.subject && result.has.subject && (
            <section aria-label={`Ricerca per ${lower(f.subject.label)}`} className={`${card} grid gap-3 p-5`}>
              <label className="grid gap-2 text-sm font-semibold sm:max-w-md">
                Cerca un {lower(f.subject.label)}
                <input className={`${field} font-normal`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Per esempio Rossi" autoComplete="off" />
              </label>
              {found && found.found > 0 && (
                <p className="text-sm" data-testid="compare-search-result">
                  <span className="font-medium">{found.names.join(", ")}</span>: {formatEuro(found.before)} nel {config.before}, {formatEuro(found.after)} nel {config.after},{" "}
                  <span className={`font-semibold ${tone(found.diff)}`}>
                    {formatEuro(found.diff, true)} ({formatPercent(found.percent)})
                  </span>
                  .
                </p>
              )}
              {found && found.found === 0 && <p className="text-sm text-(--mk-muted)">Nessun {lower(f.subject.label)} trovato.</p>}
            </section>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="button" className={primary} onClick={() => void exportExcel()}>
              Scarica il confronto in Excel
            </button>
            <button type="button" className={secondary} onClick={() => void copy()}>
              Copia
            </button>
          </div>
          {manualCopy && (
            <label className="grid gap-2 text-sm">
              Testo del confronto da copiare
              <textarea readOnly rows={8} className={`${field} font-mono text-xs`} value={manualCopy} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
        </>
      )}
      <p role="status" className="text-sm text-(--mk-muted)">
        {message}
      </p>
    </fieldset>
  );
}
