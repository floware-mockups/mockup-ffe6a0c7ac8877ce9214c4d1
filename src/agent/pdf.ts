// PDF di testo minimale, senza dipendenze, per il «Prospetto di esempio»
// (docs/mockup-ai-agent.md §3.2): una tabella in Helvetica, codifica WinAnsi.
// È un PDF vero con testo selezionabile, che il gateway può estrarre.
// Anche la determinazione e il report diventano PDF di testo (textPdf): dentro
// l'iframe di FlowareHub la stampa del browser è bloccata dalla sandbox, mentre
// il download è ammesso. Funzioni pure e deterministiche: stessi dati, stessi byte.
import type { AgentTable } from "./compute.ts";

const winAnsi = (text: string): number[] =>
  [...text].map((ch) => {
    if (ch === "€") return 0x80;
    if (ch === "–") return 0x96;
    if (ch === "—") return 0x97;
    if (ch === "’") return 0x92;
    if (ch === "·") return 0xb7;
    if (ch === "•") return 0x95;
    if (ch === "…") return 0x85;
    if (ch === "‘") return 0x91;
    if (ch === "“") return 0x93;
    if (ch === "”") return 0x94;
    const code = ch.charCodeAt(0);
    return code >= 0x20 && code <= 0xff && !(code >= 0x7f && code < 0xa0) ? code : 0x3f;
  });
// Caratteri senza equivalente WinAnsi: approssimazione leggibile invece di «?».
const plain = (text: string) => text.replace(/→/g, "->").replace(/←/g, "<-").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/−/g, "-").replace(/Δ ?/g, "Delta ");
const literal = (text: string) =>
  "(" + String.fromCharCode(...winAnsi(plain(text))).replace(/[\\()]/g, (c) => "\\" + c) + ")";
// Larghezza approssimata di Helvetica: abbastanza per allineare a destra i numeri.
const widthOf = (text: string, size: number) => text.length * size * 0.5;

export function tablePdf(title: string, subtitle: string, table: AgentTable): Uint8Array {
  const pageW = 595, pageH = 842, margin = 40, line = 15, size = 9;
  const usable = pageW - margin * 2;
  // Due caratteri di margine per colonna: senza, la cella più lunga tocca la successiva e
  // l'estrazione del testo fonde le colonne («2026-07-03 R 1201 IMU»).
  const widths = table.columns.map((c, i) => Math.max(c.length, ...table.rows.map((r) => (r[i] ?? "").length), 4) + 2);
  const totalW = widths.reduce((a, b) => a + b, 0);
  const colW = widths.map((w) => (w / totalW) * usable);
  const numeric = table.columns.map((_, i) => table.rows.every((r) => /^[-\d.,\s€%]+$/.test(r[i] ?? "")));
  const perPage = Math.floor((pageH - margin * 2 - 70) / line);
  const pages: string[] = [];
  for (let start = 0; start === 0 || start < table.rows.length; start += perPage) {
    const ops: string[] = ["BT"];
    let y = pageH - margin;
    const text = (x: number, s: string, font: "F1" | "F2", fs: number) => ops.push(`/${font} ${fs} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm ${literal(s)} Tj`);
    if (start === 0) {
      text(margin, title, "F2", 14); y -= 20;
      text(margin, subtitle, "F1", 9); y -= 26;
    } else {
      text(margin, `${title} (segue)`, "F2", 10); y -= 24;
    }
    const row = (cells: string[], font: "F1" | "F2") => {
      let x = margin;
      cells.forEach((cell, i) => {
        const s = cell ?? "";
        text(numeric[i] && font === "F1" ? x + colW[i] - widthOf(s, size) - 4 : x, s, font, size);
        x += colW[i];
      });
      y -= line;
    };
    row(table.columns, "F2");
    for (const r of table.rows.slice(start, start + perPage)) row(r, "F1");
    ops.push("ET");
    // Righe della tabella sotto l'intestazione.
    ops.push(`0.6 G 0.5 w ${margin} ${(pageH - margin - (start === 0 ? 46 : 24) - 4).toFixed(1)} m ${pageW - margin} ${(pageH - margin - (start === 0 ? 46 : 24) - 4).toFixed(1)} l S`);
    ops.push("BT /F1 7 Tf 1 0 0 1 40 24 Tm " + literal(`Dati inventati per una dimostrazione · pagina ${pages.length + 1}`) + " Tj ET");
    pages.push(ops.join("\n"));
    if (table.rows.length === 0) break;
  }
  return assemblePdf(pages, pageW, pageH);
}

/** Oggetti, xref e trailer di un PDF con Helvetica e Helvetica-Bold (WinAnsi). */
function assemblePdf(pages: string[], pageW: number, pageH: number): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add(""), pagesObj = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const content of pages) {
    // `literal()` ha già convertito il testo in byte WinAnsi: niente seconda codifica.
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info << /Producer (Prototipo Floware) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  // Ogni carattere è già un byte (WinAnsi o ASCII): conversione 1:1.
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}

export type PdfLine = { text: string; bold?: boolean; size?: number; center?: boolean; indent?: number; before?: number };

/** Documento di testo A4 con a capo automatico, intestazioni in grassetto e numero di pagina. */
export function textPdf(lines: PdfLine[], footer: string): Uint8Array {
  const pageW = 595, pageH = 842, margin = 56, bottom = 60;
  const pages: string[] = [];
  let ops: string[] = [], y = pageH - margin;
  const flush = () => {
    ops.push("BT /F1 7 Tf 1 0 0 1 56 30 Tm " + literal(`${footer} · pagina ${pages.length + 1}`) + " Tj ET");
    pages.push(ops.join("\n"));
    ops = [];
    y = pageH - margin;
  };
  for (const line of lines) {
    const size = line.size ?? 10, lead = size * 1.45, indent = line.indent ?? 0;
    // Larghezza media di Helvetica, prudente per il grassetto.
    const perChar = size * (line.bold ? 0.56 : 0.52);
    const max = Math.max(10, Math.floor((pageW - margin * 2 - indent) / perChar));
    const wrapped: string[] = [];
    for (const word of line.text.split(/\s+/).filter(Boolean)) {
      const last = wrapped[wrapped.length - 1];
      if (last !== undefined && (last + " " + word).length <= max) wrapped[wrapped.length - 1] = last + " " + word;
      else wrapped.push(word.length > max ? word.slice(0, max) : word);
    }
    if (!wrapped.length) wrapped.push("");
    y -= line.before ?? 0;
    for (const text of wrapped) {
      if (y - lead < bottom) flush();
      y -= lead;
      const x = line.center ? Math.max(margin, (pageW - text.length * perChar) / 2) : margin + indent;
      ops.push(`BT /${line.bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm ${literal(text)} Tj ET`);
    }
  }
  flush();
  return assemblePdf(pages, pageW, pageH);
}
