// WZ-2126: tipo di pagina «Scadenzario a semaforo» (livello 1 di Rovigo, ma
// generico: scadenze di qualsiasi ufficio, rinnovi, manutenzioni). Le colonne
// usate (data, descrizione, ufficio, responsabile, norma, ricorrenza,
// completamento) le indica la specifica in `page.deadlines`.
// Copia identica in shared/mockupKinds/Deadlines.tsx (anteprima di FlowareHub).
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  calendarMonth,
  completeDeadline,
  deadlineItems,
  deadlineLightLabels,
  deadlinesTable,
  distinctOf,
  emptyDeadlineFilters,
  filterDeadlines,
  formatItalianDate,
  isWeekend,
  monthName,
  msUntilNextDay,
  parseDeadlineDate,
  previousFriday,
  reopenDeadline,
  todayIso,
  weekdayName,
  type DeadlineFilters,
  type DeadlineLight,
  type DeadlinesConfig,
} from "./deadlinesLogic";
import { copyText, downloadText, loadKindState, saveKindState } from "./storage";

const card = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) shadow-sm";
const field = "w-full min-w-0 rounded-md border border-(--mk-border) bg-(--mk-surface) px-3 py-2";
const primary = "rounded-lg bg-(--mk-primary) px-4 py-2 font-medium text-(--mk-on-primary)";
const secondary = "rounded-lg border border-(--mk-border) px-3 py-2 text-sm font-medium";
// Semaforo: colori fissi e testo scuro su fondo chiaro (contrasto AA), sempre con l'etichetta scritta.
const lightStyle: Record<DeadlineLight, string> = {
  rosso: "bg-red-100 text-red-900 border-red-300",
  giallo: "bg-amber-100 text-amber-900 border-amber-300",
  verde: "bg-emerald-100 text-emerald-900 border-emerald-300",
  grigio: "bg-slate-200 text-slate-800 border-slate-300",
};
const dot: Record<DeadlineLight, string> = { rosso: "bg-red-600", giallo: "bg-amber-500", verde: "bg-emerald-600", grigio: "bg-slate-500" };

type Page = { id: string; columns: string[]; rows: string[][] };

/** «Oggi» del browser, aggiornato a mezzanotte e quando si torna sulla scheda. */
function useToday() {
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setToday(todayIso());
      clearTimeout(timer);
      timer = setTimeout(refresh, msUntilNextDay());
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    timer = setTimeout(refresh, msUntilNextDay());
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return today;
}

export function Deadlines({ page, config, storageKey, inert = false }: { page: Page; config: DeadlinesConfig; storageKey?: string; inert?: boolean }) {
  const today = useToday();
  // Le righe restano come nella specifica: le date di esempio («+3» giorni da
  // oggi) si calcolano a ogni visualizzazione, quindi il semaforo è giusto
  // anche nei giorni seguenti. Solo una riga che l'utente tocca prende una
  // data fissa. Nel browser si scrive solo dopo una modifica, mai all'apertura.
  const [rows, setRowsState] = useState<string[][]>(() => {
    const saved = loadKindState(storageKey, "rows");
    const valid = Array.isArray(saved) && saved.length <= 30 && saved.every((r) => Array.isArray(r) && r.length === page.columns.length && r.every((c) => typeof c === "string"));
    return valid ? (saved as string[][]) : page.rows.map((r) => [...r]);
  });
  const setRows = (next: string[][]) => {
    setRowsState(next);
    saveKindState(storageKey, "rows", next);
  };
  const [filters, setFilters] = useState<DeadlineFilters>(emptyDeadlineFilters);
  const [view, setView] = useState<"tabella" | "calendario">("tabella");
  const [month, setMonth] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [message, setMessage] = useState("");
  const [manualCopy, setManualCopy] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const items = useMemo(() => deadlineItems(rows, config, today), [rows, config, today]);
  const { counts, shown } = filterDeadlines(items, filters);
  // Righe con una data che non si riesce a leggere (per esempio «15 dicembre»): si segnalano, non spariscono in silenzio.
  const undated = rows.filter((_, i) => !items.some((item) => item.index === i));
  const offices = distinctOf(items, "office");
  const owners = distinctOf(items, "owner");
  const label = (column: number | undefined, fallback: string) => (column === undefined ? fallback : page.columns[column] ?? fallback);
  const canComplete = config.completedColumn !== undefined;
  const say = (text: string) => {
    setMessage(text);
    setManualCopy("");
  };

  const complete = (index: number) => {
    const result = completeDeadline(rows, index, config, today);
    setRows(result.rows);
    if (result.next) say(`Scadenza completata. Creata la stessa scadenza per il ${formatItalianDate(result.next)} (${weekdayName(result.next)}).`);
    else if (result.full) say("Scadenza completata. Non c'è spazio per quella dell'anno successivo: al massimo 30 scadenze.");
    else say("Scadenza completata.");
  };
  const reopen = (index: number) => {
    setRows(reopenDeadline(rows, index, config));
    say("Scadenza riaperta.");
  };
  const remove = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
    say("Scadenza eliminata.");
  };
  const copyList = async () => {
    const text = deadlinesTable(shown);
    if (await copyText(text)) say(`Elenco copiato: ${shown.length} scadenze. Si incolla anche in Excel.`);
    else {
      setMessage("Il browser non permette la copia automatica: seleziona il testo qui sotto e copialo.");
      setManualCopy(text);
    }
  };
  const exportList = () => {
    const ok = downloadText(`scadenze-${today}.csv`, deadlinesTable(shown, ";"), "text/csv;charset=utf-8");
    say(ok ? `File scaricato: ${shown.length} scadenze, si apre con Excel.` : "Il browser non permette di scaricare il file: usa «Copia elenco».");
  };
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const date = parseDeadlineDate(draftDate, today);
    if (!date || date < minDate || date > maxDate) return say(`Indica una data valida, tra il ${formatItalianDate(minDate)} e il ${formatItalianDate(maxDate)}.`);
    if (rows.length >= 30) return say("Al massimo 30 scadenze in questo prototipo.");
    const row = page.columns.map(() => "");
    row[config.dateColumn] = formatItalianDate(date);
    for (const [key, column] of [["description", config.descriptionColumn], ["office", config.officeColumn], ["owner", config.ownerColumn], ["norm", config.normColumn], ["recurrence", config.recurrenceColumn]] as const)
      if (column !== undefined) row[column] = String(data.get(key) ?? "").trim().slice(0, 200);
    setRows([...rows, row]);
    form.reset();
    setDraftDate("");
    say(`Scadenza aggiunta per il ${formatItalianDate(date)}.`);
  };

  const counters: { light: DeadlineLight; label: string }[] = [
    { light: "rosso", label: "Rosse" },
    { light: "giallo", label: "Gialle" },
    { light: "verde", label: "Verdi" },
    { light: "grigio", label: "Completate" },
  ];
  const cells = calendarMonth(month.year, month.month, shown);
  const shiftMonth = (delta: number) => {
    const n = month.year * 12 + month.month - 1 + delta;
    setMonth({ year: Math.floor(n / 12), month: (n % 12) + 1 });
  };
  // Date ammesse nel modulo: da 10 anni fa a 20 anni da oggi.
  const year = Number(today.slice(0, 4));
  const minDate = `${year - 10}-01-01`;
  const maxDate = `${year + 20}-12-31`;
  const draftValid = parseDeadlineDate(draftDate, today);
  const weekend = draftValid && isWeekend(draftValid) ? previousFriday(draftValid) : null;

  return (
    <div className="mt-8 grid gap-6" data-kind="deadlines">
      <section aria-label="Contatori" className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
        {counters.map((c) => (
          <div key={c.light} className={`${card} p-4`}>
            <p className="flex items-center gap-2 text-sm text-(--mk-muted)">
              <span aria-hidden className={`inline-block h-3 w-3 rounded-full ${dot[c.light]}`} />
              {c.label}
            </p>
            <p className="mt-2 text-3xl font-semibold" data-testid={`deadlines-count-${c.light}`}>{counts[c.light]}</p>
          </div>
        ))}
      </section>
      <p className="-mt-3 text-xs text-(--mk-muted)">
        Rossa: mancano meno di {config.redBelow ?? 7} giorni o è passata · Gialla: da {config.redBelow ?? 7} a {config.yellowUpTo ?? 30} giorni · Verde: oltre {config.yellowUpTo ?? 30} giorni. Oggi è {weekdayName(today)} {formatItalianDate(today)}.
      </p>

      {undated.length > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {undated.length === 1 ? "Una scadenza non ha" : `${undated.length} scadenze non hanno`} una data valida (gg/mm/aaaa) e non
          {undated.length === 1 ? " compare" : " compaiono"}: {undated.map((r) => `«${r[config.descriptionColumn] ?? ""}» (${r[config.dateColumn] ?? ""})`).join(", ")}.
        </p>
      )}
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-end gap-3 border-b border-(--mk-divider) p-5 text-sm">
          {config.officeColumn !== undefined && (
            <label className="grid gap-1">
              {label(config.officeColumn, "Ufficio")}
              <select disabled={inert} className={field} value={filters.office} onChange={(e) => setFilters({ ...filters, office: e.target.value })}>
                <option value="">Tutti</option>
                {offices.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )}
          {config.ownerColumn !== undefined && (
            <label className="grid gap-1">
              {label(config.ownerColumn, "Responsabile")}
              <select disabled={inert} className={field} value={filters.owner} onChange={(e) => setFilters({ ...filters, owner: e.target.value })}>
                <option value="">Tutti</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )}
          <label className="grid gap-1">
            Stato
            <select disabled={inert} className={field} value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value as DeadlineFilters["state"] })}>
              <option value="aperte">Solo aperte</option>
              <option value="tutte">Anche completate</option>
              <option value="rosse">Solo rosse</option>
            </select>
          </label>
          <div className="ml-auto flex flex-wrap gap-2" role="group" aria-label="Vista">
            {(["tabella", "calendario"] as const).map((v) => (
              <button key={v} type="button" disabled={inert} aria-pressed={view === v} onClick={() => setView(v)} className={view === v ? primary : secondary}>
                {v === "tabella" ? "Tabella" : "Calendario"}
              </button>
            ))}
            <button type="button" disabled={inert} className={secondary} onClick={copyList}>Copia elenco</button>
            <button type="button" disabled={inert} className={secondary} onClick={exportList}>Scarica per Excel</button>
          </div>
        </div>

        {view === "tabella" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-(--mk-subtle)">
                <tr>
                  <th className="px-4 py-3">Stato</th>
                  <th className="px-4 py-3">{label(config.dateColumn, "Data")}</th>
                  <th className="px-4 py-3">Giorni</th>
                  <th className="px-4 py-3">{label(config.descriptionColumn, "Descrizione")}</th>
                  {config.officeColumn !== undefined && <th className="px-4 py-3">{label(config.officeColumn, "Ufficio")}</th>}
                  {config.ownerColumn !== undefined && <th className="px-4 py-3">{label(config.ownerColumn, "Responsabile")}</th>}
                  {config.normColumn !== undefined && <th className="px-4 py-3">{label(config.normColumn, "Norma")}</th>}
                  <th className="px-4 py-3">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.index} className="border-t border-(--mk-divider) align-top" data-light={item.light}>
                    <td className="px-4 py-3">
                      <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${lightStyle[item.light]}`}>{deadlineLightLabels[item.light]}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatItalianDate(item.date)}
                      {item.weekend && <span className="ml-2 rounded bg-(--mk-subtle) px-1.5 py-0.5 text-xs text-(--mk-muted)" title={weekdayName(item.date)}>fine sett.</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{item.light === "grigio" ? "—" : item.days < 0 ? `scaduta da ${-item.days}` : item.days === 0 ? "oggi" : item.days}</td>
                    <td className="min-w-56 px-4 py-3 font-medium">{item.description}</td>
                    {config.officeColumn !== undefined && <td className="px-4 py-3">{item.office}</td>}
                    {config.ownerColumn !== undefined && <td className="px-4 py-3">{item.owner}</td>}
                    {config.normColumn !== undefined && <td className="min-w-48 px-4 py-3 text-xs text-(--mk-muted)">{item.norm}</td>}
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex gap-3">
                        {canComplete && (item.light === "grigio" ? (
                          <button type="button" disabled={inert} className="font-medium text-(--mk-primary)" onClick={() => reopen(item.index)}>Riapri</button>
                        ) : (
                          <button type="button" disabled={inert} className="font-medium text-(--mk-primary)" onClick={() => complete(item.index)}>Completata</button>
                        ))}
                        <button type="button" disabled={inert} className="font-medium text-(--mk-danger)" onClick={() => remove(item.index)}>Elimina</button>
                      </span>
                      {item.light === "grigio" && item.completed && (
                        <span className="mt-1 block text-xs text-(--mk-muted)">chiusa il {/^\d{4}-/.test(item.completed) ? formatItalianDate(item.completed) : item.completed}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="p-5 text-(--mk-muted)">Nessuna scadenza con questi filtri.</p>}
          </div>
        ) : (
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <button type="button" disabled={inert} className={secondary} onClick={() => shiftMonth(-1)} aria-label="Mese precedente">‹ Mese precedente</button>
              <h3 className="text-lg font-semibold capitalize">{monthName(month.month)} {month.year}</h3>
              <button type="button" disabled={inert} className={secondary} onClick={() => shiftMonth(1)} aria-label="Mese successivo">Mese successivo ›</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-xs" role="grid" aria-label={`Calendario di ${monthName(month.month)} ${month.year}`}>
              {["lun", "mar", "mer", "gio", "ven", "sab", "dom"].map((d) => (
                <div key={d} className="px-1 py-1 text-center font-semibold uppercase text-(--mk-muted)">{d}</div>
              ))}
              {cells.map((cell, i) =>
                cell ? (
                  <div key={i} className={`min-h-20 rounded-md border border-(--mk-divider) p-1 ${cell.date === today ? "ring-2 ring-(--mk-primary)" : ""} ${isWeekend(cell.date) ? "bg-(--mk-subtle)" : ""}`}>
                    <div className="text-right font-medium">{Number(cell.date.slice(8))}</div>
                    {cell.items.map((item) => (
                      <div key={item.index} className={`mt-1 rounded border px-1 py-0.5 leading-tight ${lightStyle[item.light]}`} title={item.description}>
                        {item.description}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div key={i} aria-hidden />
                ),
              )}
            </div>
          </div>
        )}
      </section>

      <section className={`${card} p-5`}>
        <h3 className="mb-4 font-semibold">Nuova scadenza</h3>
        <form className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-4" onSubmit={add}>
          <label className="grid gap-2 text-sm">
            {label(config.dateColumn, "Data")}
            <input required disabled={inert} type="date" min={minDate} max={maxDate} className={field} value={draftDate} onChange={(e) => setDraftDate(e.target.value)} />
          </label>
          <label className="grid gap-2 text-sm">
            {label(config.descriptionColumn, "Descrizione")}
            <input required disabled={inert} name="description" maxLength={200} className={field} autoComplete="off" />
          </label>
          {config.officeColumn !== undefined && (
            <label className="grid gap-2 text-sm">
              {label(config.officeColumn, "Ufficio")}
              <input disabled={inert} name="office" list={`${page.id}-offices`} maxLength={200} className={field} autoComplete="off" />
              <datalist id={`${page.id}-offices`}>{offices.map((o) => <option key={o} value={o} />)}</datalist>
            </label>
          )}
          {config.ownerColumn !== undefined && (
            <label className="grid gap-2 text-sm">
              {label(config.ownerColumn, "Responsabile")}
              <input disabled={inert} name="owner" list={`${page.id}-owners`} maxLength={200} className={field} autoComplete="off" />
              <datalist id={`${page.id}-owners`}>{owners.map((o) => <option key={o} value={o} />)}</datalist>
            </label>
          )}
          {config.normColumn !== undefined && (
            <label className="grid gap-2 text-sm">
              {label(config.normColumn, "Riferimento normativo")} (facoltativo)
              <input disabled={inert} name="norm" maxLength={200} className={field} autoComplete="off" />
            </label>
          )}
          {config.recurrenceColumn !== undefined && (
            <label className="grid gap-2 text-sm">
              {label(config.recurrenceColumn, "Ricorrenza")}
              <select disabled={inert} name="recurrence" className={field} defaultValue="nessuna">
                <option value="nessuna">Nessuna</option>
                <option value="ogni anno">Ogni anno</option>
              </select>
            </label>
          )}
          {weekend && draftValid && (
            <div role="alert" className="col-span-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              La data cade di {weekdayName(draftValid)}, quando gli uffici sono chiusi.{" "}
              <button type="button" className="font-semibold underline" onClick={() => setDraftDate(weekend)}>
                Anticipa a venerdì {formatItalianDate(weekend)}
              </button>
            </div>
          )}
          <div className="col-span-full">
            <button type="submit" disabled={inert} className={primary}>Aggiungi la scadenza</button>
          </div>
        </form>
      </section>
      <p role="status" className="text-sm text-(--mk-muted)">{message}</p>
      {manualCopy && (
        <textarea readOnly aria-label="Testo da copiare" className={`${field} h-40 w-full font-mono text-xs`} value={manualCopy} onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}
