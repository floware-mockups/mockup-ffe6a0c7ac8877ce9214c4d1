// Riconciliazione fra due tabelle caricate nella sessione (tool `data.reconcile`):
// i movimenti (per esempio il rendiconto del tesoriere) contro gli importi attesi
// (accertamenti, dovuto per contribuente). Funzioni pure: abbinamento, esiti,
// totali, KPI e serie mensile. Il modello sceglie solo le colonne; i numeri li
// calcola il codice, con lo stesso parser di tutti gli altri calcoli.
import { agentExpectedTableScore } from "./contract.ts";
import { formatEuro, formatNumber, groupByMonth, matchColumn, monthLabel, parseNumber, plainKey, type AgentTable, type MonthPoint } from "./compute.ts";

export type ReconOutcome = "abbinato" | "differenza" | "mancante" | "doppio" | "non_atteso";
export const reconOutcomeLabels: Record<ReconOutcome, string> = {
  abbinato: "Abbinato",
  differenza: "Differenza di importo",
  mancante: "Mancante nel rendiconto",
  doppio: "Possibile doppio versamento",
  non_atteso: "Non atteso",
};
export type ReconRow = {
  /** «A1»… per gli importi attesi, «N1»… per i movimenti non attesi: la chiave delle formule dell'Excel. */
  id: string;
  key: string;
  description: string;
  expected: number | null;
  actual: number;
  difference: number;
  movements: number;
  outcome: ReconOutcome;
  /** Riga della tabella degli attesi (indice), null per i non attesi. */
  expectedIndex: number | null;
  actualIndexes: number[];
};
export type ReconSide = { title: string; table: AgentTable; amountColumn: string; keyColumn?: string; descriptionColumn?: string; dateColumn?: string };
export type Reconciliation = {
  actual: ReconSide;
  expected: ReconSide;
  tolerance: number;
  rows: ReconRow[];
  /** Per ogni riga dei movimenti, l'id della riga di riconciliazione. */
  actualRowIds: string[];
  totals: {
    expected: number; actual: number; difference: number;
    abbinato: number; differenza: number; mancante: number; doppio: number; non_atteso: number;
    differenceAmount: number; missingAmount: number; duplicateAmount: number; unexpectedAmount: number;
    /** Righe dei movimenti senza importo leggibile (escluse dai totali, dette nel risultato). */
    unreadable: number;
  };
};

const expectedName = /attes|previst|dovut|accertat|da riscuotere|importi attesi|preventiv|stanziat/i;
const keyName = /capitol|contribuent|tribut|voce|codice|conto|debitor|controparte|anagrafic/i;
const descriptionName = /causal|descrizion|oggetto|motivo|dettaglio/i;

/** Punteggio «tabella degli importi attesi» (positivo) o «movimenti» (negativo): regola del contratto. */
export const expectedScore = agentExpectedTableScore;

/** Riferimenti di fattura o di documento in una riga: «118/2026», «Fattura 77/2026» → «77/2026». Mai le date. */
export function rowRefs(row: string[]): string[] {
  const out = new Set<string>();
  for (const cell of row) for (const m of (cell ?? "").matchAll(/(?<![\d/])(\d{1,6})\s*\/\s*(\d{4})(?![\d/])/g)) out.add(`${Number(m[1])}/${m[2]}`);
  return [...out];
}
const words = (s: string) => new Set(plainKey(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^(rata|rate|fattura|euro|anno|mese)$/.test(w)));

function amountColumnOf(table: AgentTable, wanted: string | undefined, prefer: RegExp): string | undefined {
  const named = wanted ? matchColumn(table, wanted, "number") : undefined;
  if (named) return named;
  const preferred = table.columns.find((c) => prefer.test(c) && matchColumn(table, c, "number") === c);
  return preferred ?? matchColumn(table, "importo", "number");
}
function keyColumnOf(actual: AgentTable, expected: AgentTable, wanted: string | undefined): [string | undefined, string | undefined] {
  if (wanted?.trim()) {
    const a = matchColumn(actual, wanted), e = matchColumn(expected, wanted);
    if (a && e) return [a, e];
  }
  const common = actual.columns.filter((c) => expected.columns.some((x) => plainKey(x) === plainKey(c)) && keyName.test(c));
  if (common.length) return [common[0], expected.columns.find((x) => plainKey(x) === plainKey(common[0]))];
  const a = actual.columns.find((c) => keyName.test(c)), e = expected.columns.find((c) => keyName.test(c));
  return [a, e];
}

/**
 * Abbina movimenti e importi attesi:
 * 1. stesso riferimento di fattura (o di documento) nelle due righe;
 * 2. stessa chiave (per esempio il capitolo): se gli attesi con quella chiave sono
 *    uno solo, prende tutti i movimenti rimasti; se sono più d'uno, vince la
 *    descrizione più simile e poi l'importo più vicino;
 * 3. senza colonna chiave: descrizione simile o importo identico.
 * Esito per importo atteso: nessun movimento → mancante; differenza entro la
 * tolleranza → abbinato; due o più movimenti per il doppio dell'atteso →
 * possibile doppio versamento; altrimenti differenza. I movimenti rimasti sono
 * non attesi. Le stesse regole stanno nelle formule dell'Excel.
 */
export function reconcileTables(
  actual: { title: string; table: AgentTable },
  expected: { title: string; table: AgentTable },
  input: { keyColumn?: string; amountColumn?: string; expectedAmountColumn?: string; descriptionColumn?: string; tolerance?: number } = {},
): Reconciliation | null {
  const A = actual.table, E = expected.table;
  const aAmount = amountColumnOf(A, input.amountColumn, /import|riscoss|incass|versat|pagat|rilevat/i);
  const eAmount = amountColumnOf(E, input.expectedAmountColumn ?? (input.amountColumn && !matchColumn(E, input.amountColumn, "number") ? undefined : input.amountColumn), expectedName);
  if (!aAmount || !eAmount || !A.rows.length || !E.rows.length) return null;
  const [aKey, eKey] = keyColumnOf(A, E, input.keyColumn);
  const aDesc = (input.descriptionColumn && matchColumn(A, input.descriptionColumn)) || A.columns.find((c) => descriptionName.test(c));
  const eDesc = (input.descriptionColumn && matchColumn(E, input.descriptionColumn)) || E.columns.find((c) => descriptionName.test(c));
  const aDate = matchColumn(A, "data", "date"), eDate = E.columns.find((c) => /scadenz/i.test(c)) ?? matchColumn(E, "data", "date");
  const col = (t: AgentTable, name?: string) => (name ? t.columns.indexOf(name) : -1);
  const ai = col(A, aAmount), ei = col(E, eAmount), ak = col(A, aKey), ek = col(E, eKey), ad = col(A, aDesc), ed = col(E, eDesc);
  const tolerance = Math.max(0, input.tolerance ?? 1);
  const amountsA = A.rows.map((r) => parseNumber(r[ai]));
  const amountsE = E.rows.map((r) => parseNumber(r[ei]) ?? 0);
  const keyOf = (r: string[], i: number) => (i >= 0 ? plainKey(r[i] ?? "") : "");
  const assigned: (number | null)[] = A.rows.map(() => null);
  const free = (j: number) => assigned[j] === null && amountsA[j] !== null;

  // 1. Riferimenti di fattura.
  const refsE = E.rows.map(rowRefs), refsA = A.rows.map(rowRefs);
  E.rows.forEach((_, i) => {
    if (!refsE[i].length) return;
    A.rows.forEach((r, j) => {
      if (free(j) && refsA[j].some((x) => refsE[i].includes(x)) && (ek < 0 || ak < 0 || keyOf(r, ak) === keyOf(E.rows[i], ek))) assigned[j] = i;
    });
  });
  const byRef = new Set(assigned.filter((x): x is number => x !== null));
  // 2. Chiave comune (capitolo, contribuente…).
  if (ak >= 0 && ek >= 0) {
    A.rows.forEach((r, j) => {
      if (!free(j)) return;
      const candidates = E.rows.map((_, i) => i).filter((i) => keyOf(E.rows[i], ek) === keyOf(r, ak) && keyOf(r, ak) !== "");
      // Un atteso abbinato per fattura non prende altri movimenti, salvo un secondo pagamento della stessa fattura (già preso al passo 1).
      const open = candidates.filter((i) => !byRef.has(i) || !refsE[i].length);
      const pool = open.length ? open : [];
      if (!pool.length) return;
      if (pool.length === 1) { assigned[j] = pool[0]; return; }
      const w = words(ad >= 0 ? r[ad] ?? "" : r.join(" "));
      const score = (i: number) => [...words(ed >= 0 ? E.rows[i][ed] ?? "" : E.rows[i].join(" "))].filter((x) => w.has(x)).length;
      assigned[j] = pool.sort((x, y) => score(y) - score(x) || Math.abs(amountsE[x] - (amountsA[j] ?? 0)) - Math.abs(amountsE[y] - (amountsA[j] ?? 0)))[0];
    });
  } else {
    // 3. Senza chiave: descrizione simile, altrimenti importo identico.
    A.rows.forEach((r, j) => {
      if (!free(j)) return;
      const w = words(ad >= 0 ? r[ad] ?? "" : r.join(" "));
      const similar = E.rows.map((_, i) => i).find((i) => [...words(ed >= 0 ? E.rows[i][ed] ?? "" : E.rows[i].join(" "))].some((x) => w.has(x)));
      const same = E.rows.map((_, i) => i).find((i) => Math.abs(amountsE[i] - (amountsA[j] ?? 0)) <= tolerance);
      const pick = similar ?? same;
      if (pick !== undefined) assigned[j] = pick;
    });
  }

  const near = (x: number, y: number) => Math.abs(x - y) <= tolerance + 1e-9;
  const rows: ReconRow[] = E.rows.map((r, i) => {
    const indexes = assigned.flatMap((x, j) => (x === i ? [j] : []));
    const total = round2(indexes.reduce((s, j) => s + (amountsA[j] ?? 0), 0));
    const exp = amountsE[i];
    const outcome: ReconOutcome = !indexes.length ? "mancante" : near(total, exp) ? "abbinato" : indexes.length >= 2 && near(total, 2 * exp) ? "doppio" : "differenza";
    return { id: `A${i + 1}`, key: ek >= 0 ? r[ek] ?? "" : "", description: ed >= 0 ? r[ed] ?? "" : r.find((c) => c && parseNumber(c) === null) ?? "", expected: exp, actual: total, difference: round2(total - exp), movements: indexes.length, outcome, expectedIndex: i, actualIndexes: indexes };
  });
  let n = 0;
  A.rows.forEach((r, j) => {
    if (assigned[j] !== null || amountsA[j] === null) return;
    rows.push({ id: `N${++n}`, key: ak >= 0 ? r[ak] ?? "" : "", description: ad >= 0 ? r[ad] ?? "" : "", expected: null, actual: amountsA[j] as number, difference: amountsA[j] as number, movements: 1, outcome: "non_atteso", expectedIndex: null, actualIndexes: [j] });
  });
  const actualRowIds = A.rows.map((_, j) => rows.find((x) => x.actualIndexes.includes(j))?.id ?? "");
  const count = (o: ReconOutcome) => rows.filter((r) => r.outcome === o).length;
  const sumOf = (o: ReconOutcome, f: (r: ReconRow) => number) => round2(rows.filter((r) => r.outcome === o).reduce((s, r) => s + f(r), 0));
  const totalExpected = round2(amountsE.reduce((s, x) => s + x, 0));
  const totalActual = round2(amountsA.reduce<number>((s, x) => s + (x ?? 0), 0));
  return {
    actual: { title: actual.title, table: A, amountColumn: aAmount, keyColumn: aKey, descriptionColumn: aDesc, dateColumn: aDate },
    expected: { title: expected.title, table: E, amountColumn: eAmount, keyColumn: eKey, descriptionColumn: eDesc, dateColumn: eDate },
    tolerance,
    rows,
    actualRowIds,
    totals: {
      expected: totalExpected,
      actual: totalActual,
      difference: round2(totalActual - totalExpected),
      abbinato: count("abbinato"), differenza: count("differenza"), mancante: count("mancante"), doppio: count("doppio"), non_atteso: count("non_atteso"),
      differenceAmount: sumOf("differenza", (r) => r.difference),
      missingAmount: sumOf("mancante", (r) => r.expected ?? 0),
      duplicateAmount: sumOf("doppio", (r) => r.difference),
      unexpectedAmount: sumOf("non_atteso", (r) => r.actual),
      unreadable: amountsA.filter((x) => x === null).length,
    },
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Frase di riepilogo del passo. */
export function reconSummary(r: Reconciliation): string {
  const t = r.totals, parts = [`${t.abbinato} abbinat${t.abbinato === 1 ? "o" : "i"}`];
  if (t.differenza) parts.push(`${t.differenza} con differenza di importo`);
  if (t.mancante) parts.push(`${t.mancante} mancant${t.mancante === 1 ? "e" : "i"} nel rendiconto`);
  if (t.doppio) parts.push(`${t.doppio} possibil${t.doppio === 1 ? "e" : "i"} doppi${t.doppio === 1 ? "o" : ""} versament${t.doppio === 1 ? "o" : "i"}`);
  if (t.non_atteso) parts.push(`${t.non_atteso} moviment${t.non_atteso === 1 ? "o" : "i"} non attes${t.non_atteso === 1 ? "o" : "i"}`);
  const unreadable = t.unreadable ? ` · ${t.unreadable} rig${t.unreadable === 1 ? "a" : "he"} senza importo leggibile` : "";
  return `${r.actual.table.rows.length} movimenti contro ${r.expected.table.rows.length} importi attesi: ${parts.join(", ")}; differenza complessiva ${signedEuro(t.difference)}${unreadable}`;
}
export const signedEuro = (n: number) => (n > 0 ? "+" : "") + formatEuro(n);

export type ReconKpi = { id: string; label: string; raw: number; unit: "€" | "n"; value: string; note?: string };
export function reconKpis(r: Reconciliation): ReconKpi[] {
  const t = r.totals;
  const n = (id: string, label: string, raw: number, note?: string): ReconKpi => ({ id, label, raw, unit: "n", value: formatNumber(raw), ...(note ? { note } : {}) });
  return [
    { id: "ric-atteso", label: "Totale atteso", raw: t.expected, unit: "€", value: formatEuro(t.expected), note: `${r.expected.table.rows.length} importi attesi` },
    { id: "ric-rilevato", label: "Totale rilevato nel rendiconto", raw: t.actual, unit: "€", value: formatEuro(t.actual), note: `${r.actual.table.rows.length} movimenti` },
    { id: "ric-differenza", label: "Differenza complessiva", raw: t.difference, unit: "€", value: signedEuro(t.difference), note: "rilevato meno atteso" },
    n("ric-abbinati", "Importi abbinati", t.abbinato, `su ${r.expected.table.rows.length} attesi`),
    n("ric-differenze", "Differenze di importo", t.differenza, t.differenza ? `${signedEuro(t.differenceAmount)} in totale` : undefined),
    n("ric-mancanti", "Mancati pagamenti", t.mancante, t.mancante ? `${formatEuro(t.missingAmount)} non rilevati` : undefined),
    n("ric-doppi", "Possibili doppi versamenti", t.doppio, t.doppio ? `${formatEuro(t.duplicateAmount)} in più` : undefined),
    n("ric-non-attesi", "Movimenti non attesi", t.non_atteso, t.non_atteso ? `${formatEuro(t.unexpectedAmount)} da verificare` : undefined),
  ];
}

/** Rilevato (per mese della data del movimento) e atteso (per mese della scadenza). */
export function reconMonthly(r: Reconciliation): MonthPoint[] {
  const actual = r.actual.dateColumn ? groupByMonth(r.actual.table, r.actual.dateColumn, r.actual.amountColumn) : [];
  const expected = r.expected.dateColumn ? groupByMonth(r.expected.table, r.expected.dateColumn, r.expected.amountColumn) : [];
  const map = new Map<string, MonthPoint>();
  for (const p of actual) map.set(p.month, { month: p.month, label: p.label, value: p.value, compare: 0 });
  for (const p of expected) {
    const point = map.get(p.month) ?? { month: p.month, label: monthLabel(p.month), value: 0, compare: 0 };
    point.compare = (point.compare ?? 0) + p.value;
    map.set(p.month, point);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Formula dell'esito nell'Excel (stesse regole di `reconcileTables`): D atteso, E rilevato, F differenza, G movimenti. */
export function reconOutcomeFormula(n: number, tolerance: number): string {
  const tol = String(tolerance).replace(",", ".");
  return `IF(D${n}="","${reconOutcomeLabels.non_atteso}",IF(G${n}=0,"${reconOutcomeLabels.mancante}",IF(ABS(F${n})<=${tol},"${reconOutcomeLabels.abbinato}",IF(AND(G${n}>=2,ABS(E${n}-2*D${n})<=${tol}),"${reconOutcomeLabels.doppio}","${reconOutcomeLabels.differenza}"))))`;
}
