// Modello della determinazione: un'unica struttura per l'anteprima, il Word
// (files.ts) e la stampa in PDF, così i tre coincidono. Funzione pura.
import type { MockupAgentManifest } from "./contract.ts";
import { fillTemplate, formatDate, formatEuro, isNormattivaUrl } from "./compute.ts";
import type { Citation, Workspace } from "./runtime.ts";
import type { PdfLine } from "./pdf.ts";
import { reconOutcomeLabels, signedEuro } from "./reconcile.ts";

export type DocBlock = { heading?: string; paragraphs: string[]; list?: boolean };
export type DocModel = {
  header: string[];
  title: string;
  subject: string;
  blocks: DocBlock[];
  notes: { citation: string; url: string; verified?: string }[];
  footer: string;
};

const pick = (vars: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const hit = Object.entries(vars).find(([key]) => key.toLowerCase().includes(k));
    if (hit?.[1]?.trim()) return hit[1].trim();
  }
  return "";
};
const matches = (heading: string, ...words: string[]) => words.some((w) => heading.toLowerCase().includes(w));

export function determinaModel(manifest: MockupAgentManifest, ws: Workspace, today: number): DocModel {
  const v = ws.variables;
  const subject = pick(v, "oggetto") || "[oggetto]";
  const operatore = pick(v, "operatore", "fornitore", "ditta");
  const importo = pick(v, "importo");
  const capitolo = pick(v, "capitolo");
  const rup = pick(v, "rup", "responsabile");
  const cpv = pick(v, "cpv");
  const sections = ws.draft?.sections ?? [];
  const used = new Set<number>();
  const take = (...words: string[]) => sections.flatMap((s, i) => (matches(s.heading, ...words) && !used.has(i) ? (used.add(i), s.paragraphs) : []));
  const template = manifest.sampleDocuments.find((d) => d.id === ws.sampleDocumentId && d.text) ?? manifest.sampleDocuments.find((d) => d.kind === "modello" && d.text);
  const premesse = take("premess");
  const filled = template?.text ? fillTemplate(template.text, v).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [];
  const visto = ws.citations.filter((c) => isNormattivaUrl(c.url)).map((c) => `Visto ${/^(il|la|lo|l')\s/i.test(c.citation) ? "" : "il "}${c.citation} (${c.title});`);
  const considerato = [
    ...take("consider", "motiv"),
    ...(ws.threshold ? [`che l'importo dell'affidamento, pari a ${formatEuro(ws.threshold.amount)} oltre IVA, è ${ws.threshold.allowed ? "inferiore" : "non inferiore"} alla soglia di ${formatEuro(ws.threshold.threshold)} prevista per ${ws.threshold.category}${ws.threshold.prepared ? " (soglia tratta da un esempio preparato, da verificare sul testo vigente)" : ""};`] : []),
    ...(ws.rotation ? [
      `che è stata svolta una verifica indicativa sul principio di rotazione (art. 49 del D.Lgs. 36/2023): nell'archivio degli affidamenti ${ws.rotation.respected ? `non risultano affidamenti a ${ws.rotation.operator} nei ${ws.rotation.months} mesi controllati` : `risultano ${ws.rotation.matches} affidament${ws.rotation.matches === 1 ? "o" : "i"} a ${ws.rotation.operator} nei ${ws.rotation.months} mesi controllati${ws.rotation.last !== null ? `, l'ultimo il ${formatDate(ws.rotation.last)}` : ""}`};`,
      `che resta da verificare se l'operatore sia il contraente uscente in due affidamenti consecutivi nello stesso settore merceologico${ws.rotation.respected ? "" : " e, in tal caso, motivare la deroga"};`,
    ] : []),
  ];
  const dispositivo = take("determin", "disposit");
  const defaults = [
    `di affidare direttamente${operatore ? ` a ${operatore}` : ""} ${subject.toLowerCase().startsWith("il ") ? "" : "il servizio di "}«${subject}»${importo ? `, per l'importo di ${importo} oltre IVA` : ""}${cpv ? ` (CPV ${cpv})` : ""};`,
    ...(capitolo ? [`di impegnare la spesa sul capitolo ${capitolo} del bilancio di previsione;`] : []),
    ...(rup ? [`di individuare quale Responsabile unico del progetto ${rup};`] : []),
    "di disporre la pubblicazione del presente atto nella sezione «Amministrazione trasparente».",
  ];
  const others = sections.filter((_, i) => !used.has(i));
  return {
    header: ["COMUNE DI ESEMPIO", "Settore Servizi tecnici · dati dimostrativi"],
    title: `DETERMINAZIONE N. [numero] DEL ${formatDate(today)}`,
    subject: `OGGETTO: ${subject}${operatore ? ` — affidamento diretto a ${operatore}` : ""}`,
    blocks: [
      { heading: "IL RESPONSABILE DEL SERVIZIO", paragraphs: premesse.length ? premesse : filled.length ? filled : ["Premesso che l'ente deve provvedere all'acquisizione in oggetto;"] },
      ...(visto.length ? [{ paragraphs: visto, list: true }] : []),
      ...(considerato.length ? [{ heading: "Considerato", paragraphs: considerato, list: true }] : []),
      ...others.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs })),
      { heading: "DETERMINA", paragraphs: dispositivo.length ? dispositivo : defaults, list: true },
    ],
    notes: ws.citations.filter((c: Citation) => isNormattivaUrl(c.url)).map((c: Citation) => ({ citation: c.citation, url: c.url, ...(c.verifiedAt ? { verified: formatDate(c.verifiedAt) } : {}) })),
    footer: "Documento dimostrativo generato da un prototipo Floware con dati inventati. Non ha valore di atto amministrativo.",
  };
}

/** Righe del PDF di testo della determinazione (stesso modello dell'anteprima e del Word). */
export function determinaPdfLines(doc: DocModel): PdfLine[] {
  const lines: PdfLine[] = [
    ...doc.header.map((h, i) => ({ text: h, bold: i === 0, size: i === 0 ? 13 : 9, center: true })),
    { text: doc.title, bold: true, center: true, before: 14 },
    { text: doc.subject, bold: true, before: 12 },
  ];
  for (const b of doc.blocks) {
    if (b.heading) lines.push({ text: b.heading, bold: true, center: b.heading === b.heading.toUpperCase(), before: 10 });
    for (const p of b.paragraphs) lines.push(b.list ? { text: "• " + p, indent: 12, before: 3 } : { text: p, before: 3 });
  }
  if (doc.notes.length) {
    lines.push({ text: "Note e riferimenti normativi", bold: true, before: 14 });
    doc.notes.forEach((n, i) => lines.push({ text: `[${i + 1}] ${n.citation}${isNormattivaUrl(n.url) ? ` — ${n.url}` : ""}${n.verified ? ` (testo vigente verificato il ${n.verified})` : ""}`, size: 8, before: 2 }));
  }
  lines.push({ text: doc.footer, size: 8, before: 16 });
  return lines;
}

/** Righe del PDF di testo del report: KPI, andamento mensile, anomalie e commento. */
export function reportPdfLines(ws: Workspace, title: string): PdfLine[] {
  const lines: PdfLine[] = [
    { text: title, bold: true, size: 15 },
    { text: "Comune di Esempio · dati inventati per una dimostrazione", size: 9, before: 2 },
  ];
  if (ws.kpis?.length) {
    lines.push({ text: "Indicatori", bold: true, before: 14 });
    for (const k of ws.kpis) lines.push({ text: `${k.label}: ${k.value}${k.note ? ` (${k.note})` : ""}`, indent: 12, before: 2 });
  }
  if (ws.chart) {
    lines.push({ text: ws.chart.title, bold: true, before: 14 });
    for (const p of ws.chart.points) lines.push({ text: `${p.label}: ${formatEuro(p.value)}${ws.chart.compareColumn ? ` · ${ws.chart.compareColumn} ${formatEuro(p.compare ?? 0)}` : ""}`, indent: 12, before: 1 });
  }
  if (ws.comparison) {
    lines.push({ text: `Anomalie (${ws.comparison.anomalies.length})`, bold: true, before: 14 });
    for (const a of ws.comparison.anomalies.slice(0, 15)) lines.push({ text: `${a.label}: ${a.reason}`, indent: 12, before: 1 });
  }
  if (ws.reconciliation) {
    const r = ws.reconciliation;
    lines.push({ text: `Riconciliazione: ${r.actual.title} con ${r.expected.title}`, bold: true, before: 14 });
    lines.push({ text: `Atteso ${formatEuro(r.totals.expected)} · rilevato ${formatEuro(r.totals.actual)} · differenza ${signedEuro(r.totals.difference)}`, indent: 12, before: 2 });
    for (const x of r.rows.filter((x) => x.outcome !== "abbinato").slice(0, 20))
      lines.push({ text: `${[x.key, x.description].filter(Boolean).join(" · ")}: ${reconOutcomeLabels[x.outcome]} (atteso ${x.expected === null ? "—" : formatEuro(x.expected)}, rilevato ${formatEuro(x.actual)})`, indent: 12, before: 1 });
  }
  if (ws.draft) {
    lines.push({ text: ws.draft.title ?? "Commento", bold: true, before: 14 });
    for (const s of ws.draft.sections) {
      lines.push({ text: s.heading, bold: true, before: 6 });
      for (const p of s.paragraphs) lines.push({ text: p, before: 2 });
    }
  }
  return lines;
}
