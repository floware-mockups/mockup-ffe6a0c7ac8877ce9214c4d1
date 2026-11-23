// WZ-2123: API dei componenti su misura (template v7). È l'unico modulo che i file
// di src/custom/ possono importare oltre a "react": lo controlla Floware prima di
// salvare il componente e di nuovo alla pubblicazione. I dati sono quelli del
// prototipo, solo in memoria: un componente legge sempre lo stato corrente e trova
// le colonne per nome, quindi segue da solo le modifiche fatte con la chat veloce
// (una colonna nuova, righe aggiunte, una pagina rinominata).
// Nessuna rete, nessun accesso a window/document: i colori vengono solo dai token
// del tema (--mk-*), già verificati per il contrasto. I componenti qui sotto chiamano
// i gestori dei componenti su misura con valori semplici e MAI con l'evento del
// browser: il codice generato non raggiunge il DOM (vedi convex/lib/mockupCustomCode.ts).
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { distinctValues, statusColumnOf } from "./logic";

export type Row = string[];
export type PageData = {
  id: string;
  title: string;
  description: string;
  columns: string[];
  rows: Row[];
  statusColumn?: number;
};
/** Azione che un componente di conferma può approvare o annullare. */
export type CustomAction = {
  kind: "status" | "remove" | "add";
  pageId: string;
  rowIndex: number;
  row: Row;
  /** Solo per il cambio di stato. */
  from?: string;
  to?: string;
};
export type Runtime = {
  title: string;
  pages: PageData[];
  pageId: string;
  /** Aggiorna le righe a partire da quelle correnti (più scritture di fila non si perdono). */
  setRows: (pageId: string, update: (rows: Row[]) => Row[], message?: string) => void;
  navigate: (pageId: string) => void;
  openDetail: (pageId: string, rowIndex: number) => void;
  notify: (message: string) => void;
};
// Interno: lo fornisce main.tsx. I componenti usano gli hook qui sotto.
export const FlowareRuntime = createContext<Runtime | null>(null);

// --- Componenti su misura esclusi (interno: main.tsx e customGuard.ts) -----------------
// Un componente che si comporta male (una finestra che si riapre da sola, codice che lavora
// troppo a lungo, testi da modulo di accesso) si esclude fino al prossimo caricamento: in
// tutti i suoi punti compare il riquadro di errore (o il comportamento standard).
const stoppedComponents = new Set<string>();
const stopListeners = new Set<() => void>();
export function stopCustomComponent(name: string, reason: string) {
  if (!name || stoppedComponents.has(name)) return;
  stoppedComponents.add(name);
  console.warn(`[floware] componente su misura «${name}» escluso: ${reason}`);
  for (const listener of [...stopListeners]) {
    try {
      listener();
    } catch {
      // un ascoltatore rotto non ferma gli altri
    }
  }
}
export const customComponentStopped = (name: string) => stoppedComponents.has(name);
export function subscribeCustomStops(listener: () => void) {
  stopListeners.add(listener);
  return () => {
    stopListeners.delete(listener);
  };
}

// --- Gesti dell'utente e finestre dei componenti su misura (interno) ------------------
// Clic, tocchi e tasti veri (isTrusted), contati dal template prima di ogni altro gestore:
// il codice generato non li vede e non li può simulare.
let gestureSeq = 0;
let gestureAt = Number.NEGATIVE_INFINITY;
if (typeof window !== "undefined") {
  const mark = (event: Event) => {
    if (!event.isTrusted) return;
    gestureSeq++;
    gestureAt = performance.now();
  };
  for (const type of ["pointerdown", "keydown", "click"]) window.addEventListener(type, mark, { capture: true, passive: true });
}
export const currentGesture = () => ({ seq: gestureSeq, at: gestureAt });
/** Un gesto conta per un'apertura se è di al massimo 1,5 s prima. */
export const customGestureWindow = 1500;
/** Dopo una chiusura, per 10 s una finestra si riapre solo da un controllo del componente. */
export const customReopenCooldown = 10000;
/** Riquadro di un componente su misura (uno per punto di aggancio, vedi CustomSlot in main.tsx). */
export type CustomSlotState = {
  name: string;
  mountedAt: number;
  /** Il riquadro è comparso su un gesto (conferme, dettaglio, cambio di pagina). */
  mountedOnGesture: boolean;
  opened: number;
  /** Gesto dell'ultimo controllo dell'API (Button, campi) usato dentro il componente. */
  lastControlSeq: number;
  lastDismissSeq: number;
  lastDismissAt: number;
  /** Chiusure di finestre che il componente aveva aperto da solo (non da un suo controllo). */
  selfDismissals: number;
  blocked: number[];
  /** Radici delle finestre aperte (portal nel body): il template ne controlla i testi. */
  portals: Set<Element>;
  watch?: (root: Element) => void;
};
export const CustomSlotContext = createContext<CustomSlotState | null>(null);
export function newCustomSlot(name: string, now = performance.now()): CustomSlotState {
  return {
    name,
    mountedAt: now,
    mountedOnGesture: now - gestureAt <= customGestureWindow,
    opened: 0,
    lastControlSeq: -1,
    lastDismissSeq: -1,
    lastDismissAt: Number.NEGATIVE_INFINITY,
    selfDismissals: 0,
    blocked: [],
    portals: new Set(),
  };
}
/**
 * Una finestra (Dialog, Drawer) di un componente su misura si apre solo su un gesto
 * dell'utente: recente, successivo a quello che ha chiuso l'ultima finestra e, nei 10 s
 * dopo una chiusura, solo da un controllo del componente stesso (un suo pulsante). La
 * prima finestra di un riquadro comparso su un gesto (conferma, dettaglio) si apre anche
 * se il componente arriva qualche istante dopo. Due riaperture bloccate nei 10 s dopo una
 * chiusura escludono il componente.
 */
export function customWindowDecision(slot: CustomSlotState, gesture: { seq: number; at: number }, now: number) {
  const recent = now - gesture.at <= customGestureWindow;
  const viaControl = recent && slot.lastControlSeq === gesture.seq;
  const firstOnMount = slot.opened === 0 && slot.mountedOnGesture && now - slot.mountedAt <= 5000;
  const afterLastDismiss = gesture.seq > slot.lastDismissSeq;
  const cooling = now - slot.lastDismissAt < customReopenCooldown && !viaControl;
  const open = !customComponentStopped(slot.name) && (recent || firstOnMount) && afterLastDismiss && !cooling;
  let exclude = false;
  if (open) slot.opened++;
  else if (now - slot.lastDismissAt < customReopenCooldown) {
    slot.blocked = [...slot.blocked.filter((t) => now - t < customReopenCooldown), now];
    exclude = slot.blocked.length >= 2;
  }
  return { open, viaControl, exclude };
}
/** Una finestra si è chiusa (Esc, clic fuori, «×»). Vero se il componente va escluso. */
export function customWindowDismissed(slot: CustomSlotState, viaControl: boolean, gesture: { seq: number }, now: number) {
  slot.lastDismissSeq = gesture.seq;
  slot.lastDismissAt = now;
  if (viaControl) return false;
  slot.selfDismissals++;
  return slot.selfDismissals >= 2;
}
/** Le finestre di un componente su misura si fanno controllare dal suo riquadro (testi). */
function usePortalWatch() {
  const slot = useContext(CustomSlotContext);
  const current = useRef<Element | null>(null);
  return useCallback(
    (root: HTMLDivElement | null) => {
      if (!slot) return;
      if (current.current) slot.portals.delete(current.current);
      current.current = root;
      if (root) {
        slot.portals.add(root);
        slot.watch?.(root);
      }
    },
    [slot],
  );
}
/** I controlli dell'API segnano il gesto con cui li si usa (per le finestre che aprono). */
function useControlMark() {
  const slot = useContext(CustomSlotContext);
  return () => {
    if (slot) slot.lastControlSeq = gestureSeq;
  };
}

// Props dei cinque ruoli (vedi docs/mockup-advanced-assistant.md).
export type SectionProps = { pageId: string };
export type ConfirmProps = { action: CustomAction; confirm: () => void; cancel: () => void };
export type DetailProps = { pageId: string; rowIndex: number; row: Row; close: () => void };
export type CellProps = { pageId: string; rowIndex: number; column: string; value: string; row: Row };
export type FloatingProps = { pageId: string };

const fold = (text: string) =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const clip = (value: unknown) => String(value ?? "").slice(0, 200);

function useRuntime(): Runtime {
  const value = useContext(FlowareRuntime);
  if (!value) throw new Error("floware_runtime_missing");
  return value;
}

/** Titolo, pagine e navigazione del prototipo. */
export function usePrototype() {
  const r = useRuntime();
  // Funzioni nuove a ogni chiamata: il componente non riceve mai quelle di main.tsx.
  return {
    title: r.title,
    pageId: r.pageId,
    pages: r.pages.map((p) => ({ id: p.id, title: p.title })),
    navigate: (pageId: string) => r.navigate(String(pageId)),
    openDetail: (pageId: string, rowIndex: number) => r.openDetail(String(pageId), Number(rowIndex)),
    notify: (message: string) => r.notify(String(message ?? "")),
  };
}

export type Table = {
  id: string;
  title: string;
  columns: string[];
  rows: Row[];
  /** Indice della colonna per nome (maiuscole e accenti non contano), -1 se manca. */
  column: (name: string) => number;
  /** Valore di una cella per riga (indice o riga) e colonna (nome o indice); "" se manca. */
  value: (row: Row | number, column: string | number) => string;
  /** Colonna degli stati (-1 se la pagina non ne ha) e i suoi valori. */
  statusColumn: number;
  statuses: string[];
  /** Righe il cui valore nella colonna coincide (maiuscole e accenti non contano). */
  findRows: (column: string, value: string) => number[];
  setCell: (rowIndex: number, column: string | number, value: string) => void;
  addRow: (values: Record<string, string> | Row) => void;
  removeRow: (rowIndex: number) => void;
};

// Esportata solo per le prove (scripts/mockup-floware-api.test.mjs): i componenti su misura
// usano useTable.
export function tableOf(r: Runtime, page: PageData): Table {
  const column = (name: string) => {
    const wanted = fold(name);
    if (!wanted) return -1;
    const exact = page.columns.findIndex((c) => fold(c) === wanted);
    if (exact >= 0 || wanted.length < 3) return exact;
    return page.columns.findIndex((c) => fold(c).includes(wanted));
  };
  const at = (c: string | number) => (typeof c === "number" ? c : column(c));
  const status = statusColumnOf(page);
  return {
    id: page.id,
    title: page.title,
    // Copie: il componente non può alterare lo stato del prototipo per sbaglio.
    columns: [...page.columns],
    rows: page.rows.map((row) => [...row]),
    column,
    value: (row, c) => {
      const values = typeof row === "number" ? page.rows[row] : row;
      const i = at(c);
      return values && i >= 0 ? (values[i] ?? "") : "";
    },
    statusColumn: status,
    statuses: distinctValues(page.rows, status),
    findRows: (c, value) => {
      const i = column(c);
      const wanted = fold(value);
      if (i < 0 || !wanted) return [];
      return page.rows.flatMap((row, index) => (fold(row[i] ?? "") === wanted ? [index] : []));
    },
    // Le scritture partono dalle righe correnti, non da quelle di questo render: due setCell
    // o due addRow nello stesso gestore valgono entrambi. Valori e righe si calcolano subito.
    setCell: (rowIndex, c, value) => {
      const i = at(c);
      if (i < 0 || !Number.isInteger(rowIndex) || rowIndex < 0) return;
      const text = clip(value);
      r.setRows(page.id, (rows) => (rows[rowIndex] ? rows.map((row, index) => (index === rowIndex ? row.map((cell, j) => (j === i ? text : cell)) : row)) : rows));
    },
    addRow: (values) => {
      const row = Array.isArray(values)
        ? page.columns.map((_, i) => clip(values[i] ?? "—") || "—")
        : page.columns.map((name) => {
            const key = Object.keys(values).find((k) => fold(k) === fold(name));
            return (key && clip(values[key])) || "—";
          });
      r.setRows(page.id, (rows) => (rows.length >= 60 ? rows : [...rows, row]));
    },
    removeRow: (rowIndex) => r.setRows(page.id, (rows) => rows.filter((_, index) => index !== rowIndex)),
  };
}

/** Tabella di una pagina (quella aperta se pageId manca). null se la pagina non c'è più. */
export function useTable(pageId?: string): Table | null {
  const r = useRuntime();
  const page = pageId ? r.pages.find((p) => p.id === pageId) : (r.pages.find((p) => p.id === r.pageId) ?? r.pages[0]);
  return page ? tableOf(r, page) : null;
}

/** Una riga di una pagina, con i valori per nome di colonna. null se non esiste. */
export function useRow(pageId: string | undefined, rowIndex: number) {
  const table = useTable(pageId);
  const values = table?.rows[rowIndex];
  if (!table || !values) return null;
  return { index: rowIndex, values, get: (column: string) => table.value(values, column) };
}

/** Chiama la funzione quando si preme Esc (finestre e pannelli). */
export function useEscape(onEscape: () => void) {
  const latest = useRef(onEscape);
  useEffect(() => {
    latest.current = onEscape;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

// --- Elementi grafici: solo token del tema, quindi contrasto già verificato. ---

const surface = "rounded-xl border border-(--mk-divider) bg-(--mk-surface) text-(--mk-text) shadow-sm";
type ButtonProps = {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "link";
  disabled?: boolean;
  title?: string;
  autoFocus?: boolean;
};
// Sempre type="button": nel prototipo non ci sono moduli da inviare.
export function Button({ children, onClick, variant = "primary", disabled, title, autoFocus }: ButtonProps) {
  const mark = useControlMark();
  const look =
    variant === "primary"
      ? "rounded-lg px-4 py-2 bg-(--mk-primary) text-(--mk-on-primary)"
      : variant === "danger"
        ? "rounded-lg px-4 py-2 border border-(--mk-danger) bg-(--mk-surface) text-(--mk-danger)"
        : variant === "link"
          ? "underline underline-offset-2 text-(--mk-primary)"
          : "rounded-lg px-4 py-2 border border-(--mk-border) bg-(--mk-surface) text-(--mk-text)";
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      autoFocus={autoFocus}
      onClick={
        onClick
          ? () => {
              mark();
              onClick();
            }
          : undefined
      }
      className={`text-sm font-medium disabled:opacity-50 ${look}`}
    >
      {children}
    </button>
  );
}

// Campi: chiamano onChange con il testo, la scelta o il vero/falso, mai con l'evento.
const fieldClass = "rounded-md border border-(--mk-border) bg-(--mk-surface) px-3 py-2 text-(--mk-text)";
export function TextInput({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: "text" | "number" | "date" }) {
  const id = useId();
  const mark = useControlMark();
  // Solo testo, numero o data: mai password, email o altri campi da modulo di accesso.
  const kind = type === "number" || type === "date" ? type : "text";
  return (
    <label htmlFor={id} className="grid gap-1 text-sm">
      {label}
      <input
        id={id}
        type={kind}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          mark();
          onChange(e.currentTarget.value.slice(0, 500));
        }}
        className={fieldClass}
      />
    </label>
  );
}
export function TextArea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  const id = useId();
  const mark = useControlMark();
  return (
    <label htmlFor={id} className="grid gap-1 text-sm">
      {label}
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => {
          mark();
          onChange(e.currentTarget.value.slice(0, 2000));
        }}
        className={fieldClass}
      />
    </label>
  );
}
export function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  const id = useId();
  const mark = useControlMark();
  return (
    <label htmlFor={id} className="grid gap-1 text-sm">
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => {
          mark();
          onChange(e.currentTarget.value);
        }}
        className={fieldClass}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const mark = useControlMark();
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          mark();
          onChange(e.currentTarget.checked);
        }}
      />
      {label}
    </label>
  );
}

// Ref a funzione, fuori dai componenti: il nodo del DOM non resta in un oggetto che un
// componente su misura potrebbe leggere (per esempio chiamando Dialog come funzione).
const focusOnMount = (node: HTMLDivElement | null) => {
  node?.focus();
};

// Esc, clic fuori e «×» chiudono SEMPRE la finestra: la chiusura la fa il template, poi
// avvisa il componente con onClose. Un onClose vuoto (o che lancia) non la tiene aperta.
// Dentro un componente su misura la finestra si apre solo su un gesto dell'utente e non
// si riapre da sola dopo una chiusura (customWindowDecision); le finestre del template
// (conferma e dettaglio standard) restano come prima.
const templateWindow = { open: true, viaControl: true, exclude: false };
function useDismiss(onClose: () => void) {
  const slot = useContext(CustomSlotContext);
  const [gate] = useState(() => (slot ? customWindowDecision(slot, currentGesture(), performance.now()) : templateWindow));
  const [dismissed, setDismissed] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    if (gate.exclude && slot) stopCustomComponent(slot.name, "una finestra continua a riaprirsi da sola");
  }, [gate, slot]);
  const dismiss = () => {
    if (done.current || !gate.open) return;
    done.current = true;
    setDismissed(true);
    if (slot && customWindowDismissed(slot, gate.viaControl, currentGesture(), performance.now()))
      stopCustomComponent(slot.name, "una finestra si è riaperta da sola dopo una chiusura");
    try {
      onClose();
    } catch {
      // la finestra è già chiusa: l'errore del componente non la riapre
    }
  };
  useEscape(dismiss);
  return { dismissed: dismissed || !gate.open, dismiss };
}

/** Finestra al centro della pagina (popup). Esc, clic fuori o «×» la chiudono sempre. */
export function Dialog({ title, children, onClose, footer }: { title: string; children?: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const { dismissed, dismiss } = useDismiss(onClose);
  const watch = usePortalWatch();
  const id = useId();
  if (dismissed) return null;
  // Portal nel body: i componenti su misura stanno in riquadri contenuti (contain: paint),
  // le finestre dell'API invece coprono la pagina come sempre.
  return createPortal(
    <div ref={watch} className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={dismiss}>
      <div ref={focusOnMount} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id} className={`${surface} w-full max-w-md p-6 outline-none`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 id={id} className="text-lg font-semibold">
            {title}
          </h3>
          <button type="button" aria-label="Chiudi" onClick={dismiss} className="rounded px-2 text-xl leading-none text-(--mk-muted)">
            ×
          </button>
        </div>
        <div className="grid gap-3 text-sm">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Pannello laterale (per esempio il dettaglio di una riga). Esc, clic fuori o «×» lo chiudono sempre. */
export function Drawer({ title, children, onClose, footer, side = "right" }: { title: string; children?: ReactNode; onClose: () => void; footer?: ReactNode; side?: "right" | "left" }) {
  const { dismissed, dismiss } = useDismiss(onClose);
  const watch = usePortalWatch();
  const id = useId();
  if (dismissed) return null;
  return createPortal(
    <div ref={watch} className="fixed inset-0 z-40 bg-black/30" onClick={dismiss}>
      <div
        ref={focusOnMount}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`fixed inset-y-0 ${side === "left" ? "left-0 border-r" : "right-0 border-l"} flex w-full max-w-md flex-col border-(--mk-divider) bg-(--mk-surface) text-(--mk-text) shadow-2xl outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-(--mk-divider) p-5">
          <h3 id={id} className="text-lg font-semibold">
            {title}
          </h3>
          <button type="button" aria-label="Chiudi" onClick={dismiss} className="rounded px-2 text-xl leading-none text-(--mk-muted)">
            ×
          </button>
        </div>
        <div className="grid flex-1 content-start gap-3 overflow-y-auto p-5 text-sm">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-(--mk-divider) p-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Riquadro con titolo facoltativo. */
export function Card({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <section className={`${surface} my-6 grid gap-3 p-5`}>
      {title && <h3 className="font-semibold">{title}</h3>}
      {children}
    </section>
  );
}

/** Etichetta breve (stato, conteggio). */
export function Badge({ children, tone = "neutral" }: { children?: ReactNode; tone?: "neutral" | "primary" | "danger" }) {
  const look =
    tone === "primary"
      ? "bg-(--mk-primary) text-(--mk-on-primary)"
      : tone === "danger"
        ? "border border-(--mk-danger) text-(--mk-danger)"
        : "bg-(--mk-subtle) text-(--mk-text)";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${look}`}>{children}</span>;
}

/** Coppia etichetta–valore, per dettagli e riepiloghi. */
export function Field({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-(--mk-muted)">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

// Funzioni dell'API congelate: un componente su misura non può cambiarne le proprietà
// che React legge (per esempio prototype.isReactComponent).
for (const api of [usePrototype, useTable, useRow, useEscape, Button, TextInput, TextArea, Select, Checkbox, Dialog, Drawer, Card, Badge, Field]) {
  Object.freeze(api.prototype);
  Object.freeze(api);
}
