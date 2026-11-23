// WZ-2126 (livello 2): lettura e scrittura dei file del confronto, solo nel
// browser. Il file scelto si legge in memoria e non lascia mai la pagina:
// nessuna rete, nessun salvataggio. Il CSV si legge qui; il .xlsx con exceljs
// (dal registry npm, licenza MIT), caricato con import() solo al primo uso.
// I vecchi .xls (formato binario) non si leggono: si chiede di salvarli come
// .xlsx o .csv.
// Copia identica in templates/mockup-v1/src/kinds/compareFiles.ts (verificata da un test).
import { compareCsv, compareLimits, groupDigits, CompareFileError, type CompareCell, type CompareRawTable, type CompareSheet } from "./compareLogic.ts";

// Parti di exceljs usate qui (stesse nel pacchetto e nei tipi minimi del template).
type XCellValue = string | number | boolean | null | { formula: string; result?: number };
type XRow = { values: unknown; font: { bold?: boolean } };
type XSheet = {
  rowCount: number;
  getRow(index: number): XRow;
  addRow(values: XCellValue[]): XRow;
  getColumn(index: number): { width: number; numFmt: string };
};
type XWorkbook = {
  creator: string;
  worksheets: XSheet[];
  addWorksheet(name: string, options?: { views?: { state: "frozen"; ySplit?: number }[] }): XSheet;
  xlsx: { load(data: ArrayBuffer): Promise<unknown>; writeBuffer(): Promise<ArrayBuffer> };
};
type XModule = { Workbook: new () => XWorkbook };
const loadExcel = async (): Promise<XModule> => {
  const mod = (await import("exceljs")) as unknown as XModule & { default?: XModule };
  return mod.default ?? mod;
};
export const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// --- CSV ------------------------------------------------------------------------

/**
 * CSV con separatore riconosciuto (punto e virgola, virgola o tabulazione) e
 * virgolette doppie. Ogni cella resta testo, così «0101» resta «0101»; `quoted`
 * segna le celle fra virgolette: un importo fra virgolette è «scritto come testo».
 */
export function parseCsv(text: string): CompareRawTable {
  const source = text.replace(/^\ufeff/, "");
  const firstLine = source.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const outside = firstLine.replace(/"[^"]*"/g, "");
  const delimiter = [";", "\t", ","].map((d) => ({ d, n: outside.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: CompareCell[][] = [];
  const quotedRows: boolean[][] = [];
  let row: CompareCell[] = [];
  let quotedRow: boolean[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  const push = () => {
    const t = field.trim();
    row.push(quoted ? field : t || null);
    quotedRow.push(quoted);
    field = "";
    quoted = false;
    if (row.length > compareLimits.columns) throw new CompareFileError(`Il file ha più di ${compareLimits.columns} colonne.`);
  };
  const endRow = () => {
    push();
    rows.push(row);
    quotedRows.push(quotedRow);
    row = [];
    quotedRow = [];
    if (rows.length > compareLimits.rows + compareLimits.headerScan) throw new CompareFileError(`Il file ha più di ${groupDigits(compareLimits.rows)} righe: nel prototipo usa un file più piccolo.`);
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"' && !field.trim()) {
      inQuotes = true;
      quoted = true;
      field = "";
    } else if (c === delimiter) push();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (inQuotes) throw new CompareFileError("Nel file CSV c'è una virgoletta non chiusa: controlla il file e riprova.");
  if (field || row.length) endRow();
  return { rows, quoted: quotedRows };
}

/** Testo del file: UTF-8 se valido, altrimenti Windows-1252 (il CSV salvato da Excel in italiano). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// --- XLSX -----------------------------------------------------------------------

type DecompressionCtor = new (format: string) => TransformStream<Uint8Array, Uint8Array>;
const tooBig = () => new CompareFileError("Il file Excel è troppo grande per il prototipo, una volta aperto.");
const damaged = () => new CompareFileError("Il file non si apre: potrebbe essere danneggiato.");
/**
 * Estrae una parte compressa contando i byte e fermandosi appena si supera
 * `limit`. Con `keep` restituisce anche il contenuto (solo per i fogli, già
 * entro il limite). null se il browser non sa estrarre da solo.
 */
async function inflate(data: Uint8Array, limit: number, keep: boolean): Promise<{ size: number; content?: Uint8Array } | null> {
  const Decompression = (globalThis as { DecompressionStream?: DecompressionCtor }).DecompressionStream;
  if (!Decompression) return null;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = new Blob([data.slice()]).stream().pipeThrough(new Decompression("deflate-raw")).getReader();
  } catch {
    return null;
  }
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        return { size };
      }
      if (keep) chunks.push(value);
    }
  } catch {
    throw damaged();
  }
  if (!keep) return { size };
  const content = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    content.set(chunk, at);
    at += chunk.byteLength;
  }
  return { size, content };
}

const columnNumber = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
/** Celle coperte da un riferimento come «A1:XFD1048576» o «B3». */
const areaOf = (ref: string) => {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})(?::\$?([A-Z]{1,3})\$?(\d{1,7}))?$/.exec(ref.trim());
  if (!m) return 0;
  const rows = Math.abs(Number(m[4] ?? m[2]) - Number(m[2])) + 1;
  const columns = Math.abs(columnNumber(m[3] ?? m[1]) - columnNumber(m[1])) + 1;
  return rows * columns;
};
/**
 * Controllo del contenuto di un foglio prima di exceljs, che espande celle
 * unite e regole di convalida cella per cella e crea ogni riga dichiarata: un
 * foglio di pochi KB con una cella unita da A1 a XFD1048576 basterebbe a
 * bloccare la scheda.
 */
export function checkWorksheetXml(xml: string) {
  const maxRows = compareLimits.rows + compareLimits.headerScan;
  const tooLarge = () => new CompareFileError(`Il foglio è troppo grande per il prototipo: al massimo ${groupDigits(compareLimits.rows)} righe e nessuna cella unita o regola che copra tutto il foglio.`);
  const dimension = /<(?:\w+:)?dimension\b[^>]*\bref="([^"]*)"/.exec(xml);
  if (dimension) {
    const last = /(\d+)$/.exec(dimension[1].trim());
    if (last && Number(last[1]) > maxRows) throw tooLarge();
  }
  for (const row of xml.matchAll(/<(?:\w+:)?row\b[^>]*?\br="(\d+)"/g)) if (Number(row[1]) > maxRows) throw tooLarge();
  let merged = 0;
  for (const cell of xml.matchAll(/<(?:\w+:)?mergeCell\b[^>]*?\bref="([^"]*)"/g)) if ((merged += areaOf(cell[1])) > compareLimits.mergedCells) throw tooLarge();
  let validated = 0;
  for (const rule of xml.matchAll(/<(?:\w+:)?dataValidation\b[^>]*?\bsqref="([^"]*)"/g))
    for (const ref of rule[1].split(/\s+/)) if ((validated += areaOf(ref)) > compareLimits.mergedCells) throw tooLarge();
}

/**
 * Controllo dell'archivio .xlsx prima di darlo a exceljs: deve essere un vero
 * file Excel (contiene il foglio di lavoro principale) e, una volta estratto,
 * non deve superare i limiti. Le dimensioni dichiarate possono mentire, quindi
 * ogni parte si estrae davvero contando i byte e fermandosi oltre il limite
 * (difesa dagli archivi «gonfiati»); dei fogli si controlla anche il contenuto
 * (checkWorksheetXml).
 */
export async function checkXlsxArchive(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new CompareFileError("Il file non si apre: non sembra un vero file Excel .xlsx.");
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (entries > compareLimits.zipEntries || entries === 0xffff || offset === 0xffffffff) throw new CompareFileError("Il file Excel è troppo complesso per il prototipo.");
  const decoder = new TextDecoder();
  const parts: { name: string; method: number; compressed: number; declared: number; local: number }[] = [];
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw damaged();
    const nameLength = view.getUint16(offset + 28, true);
    parts.push({
      method: view.getUint16(offset + 10, true),
      compressed: view.getUint32(offset + 20, true),
      declared: view.getUint32(offset + 24, true),
      local: view.getUint32(offset + 42, true),
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
    });
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (!parts.some((p) => p.name.split("/").length === 2 && p.name.split("/")[0] === "xl" && p.name.split("/")[1] === "workbook.xml"))
    throw new CompareFileError("Il file non si apre: non sembra un vero file Excel .xlsx.");
  let total = 0;
  for (const part of parts) {
    if (part.declared === 0xffffffff || part.compressed === 0xffffffff) throw tooBig();
    if (part.declared > compareLimits.unzippedEntryBytes || (total += part.declared) > compareLimits.unzippedBytes) throw tooBig();
  }
  total = 0;
  for (const part of parts) {
    if (part.local + 30 > bytes.length || view.getUint32(part.local, true) !== 0x04034b50) throw damaged();
    const start = part.local + 30 + view.getUint16(part.local + 26, true) + view.getUint16(part.local + 28, true);
    if (start + part.compressed > bytes.length) throw damaged();
    const data = bytes.subarray(start, start + part.compressed);
    const sheet = /^xl\/worksheets\/[^/]+\.xml$/.test(part.name);
    let read: { size: number; content?: Uint8Array } | null;
    if (part.method === 0) read = { size: part.compressed, content: data };
    else if (part.method === 8) read = await inflate(data, compareLimits.unzippedEntryBytes, sheet);
    else throw new CompareFileError("Il file Excel usa una compressione che il prototipo non legge: salvalo di nuovo da Excel.");
    if (read === null) return; // browser senza estrazione: restano i limiti dichiarati qui sopra
    if (read.size > compareLimits.unzippedEntryBytes || (total += read.size) > compareLimits.unzippedBytes) throw tooBig();
    if (sheet && read.content) checkWorksheetXml(new TextDecoder().decode(read.content));
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Valore di una cella di exceljs: numeri e testi; formule col loro risultato; date come gg/mm/aaaa. */
export function xlsxCellValue(value: unknown): CompareCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
  if (typeof value === "object") {
    const v = value as { result?: unknown; richText?: { text?: unknown }[]; text?: unknown; error?: unknown };
    if ("result" in v) return xlsxCellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
    if (typeof v.text === "string") return v.text;
  }
  return null;
}

async function readXlsx(bytes: Uint8Array): Promise<CompareRawTable> {
  await checkXlsxArchive(bytes);
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  try {
    const copy = bytes.slice().buffer;
    await workbook.xlsx.load(copy);
  } catch {
    throw new CompareFileError("Il file non si apre: potrebbe essere danneggiato o protetto da password.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new CompareFileError("Il file non contiene fogli.");
  if (sheet.rowCount > compareLimits.rows + compareLimits.headerScan)
    throw new CompareFileError(`Il file ha più di ${groupDigits(compareLimits.rows)} righe: nel prototipo usa un file più piccolo.`);
  const rows: CompareCell[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values;
    const cells = Array.isArray(values) ? values.slice(1, compareLimits.columns + 1) : [];
    rows.push(Array.from({ length: cells.length }, (_, i) => xlsxCellValue(cells[i])));
  }
  return { rows };
}

// --- Ingresso -------------------------------------------------------------------

/** Legge il primo foglio di un .xlsx o un .csv già in memoria. Lancia CompareFileError con un messaggio per l'utente. */
export async function readCompareFile(name: string, bytes: Uint8Array): Promise<CompareRawTable> {
  if (bytes.byteLength > compareLimits.fileBytes) throw new CompareFileError("Il file è troppo grande: il massimo è 5 MB.");
  if (!bytes.byteLength) throw new CompareFileError("Il file è vuoto.");
  const lower = name.toLowerCase();
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  // Un .xlsx protetto da password è un contenitore cifrato del vecchio formato.
  if (ole && lower.endsWith(".xlsx")) throw new CompareFileError("Il file è protetto da password: aprilo in Excel, salvalo senza password e riprova.");
  if (ole) throw new CompareFileError("I file .xls del vecchio Excel non si leggono nel prototipo: aprilo in Excel e salvalo come .xlsx oppure .csv.");
  if (zip) return readXlsx(bytes);
  if (lower.endsWith(".xlsx")) throw new CompareFileError("Il file non si apre: non sembra un vero file Excel .xlsx.");
  if (!/\.(csv|txt|xls)$/.test(lower)) throw new CompareFileError("Formato non riconosciuto: carica un file .xlsx o .csv.");
  // Molti programmi salvano come «.xls» un semplice testo separato da tabulazioni.
  const text = decodeText(bytes);
  if (text.includes("\u0000") || /^\s*</.test(text)) throw new CompareFileError("Formato non riconosciuto: salva il file come .xlsx oppure .csv.");
  return parseCsv(text);
}

// --- Uscita ---------------------------------------------------------------------

/** File .xlsx con un foglio per tabella; le colonne in `money` hanno il formato euro. */
export async function buildCompareWorkbook(sheets: CompareSheet[]): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Prototipo Floware";
  for (const s of sheets) {
    const sheet = workbook.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(s.header).font = { bold: true };
    for (const row of s.rows) sheet.addRow(row);
    s.header.forEach((h, i) => {
      const column = sheet.getColumn(i + 1);
      column.width = Math.min(48, Math.max(12, h.length + 4, ...s.rows.map((r) => String(r[i] ?? "").length + 2)));
      if (s.money.includes(i)) column.numFmt = '#,##0.00 "€"';
    });
  }
  return workbook.xlsx.writeBuffer();
}
/** File di esempio .xlsx: gli importi fra virgolette restano testo, come in un file vero con le trappole. */
export async function buildSampleWorkbook(table: CompareRawTable, name: string): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Prototipo Floware";
  const sheet = workbook.addWorksheet(name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Dati");
  table.rows.forEach((row, i) => {
    const added = sheet.addRow(row);
    if (i === 0) added.font = { bold: true };
  });
  table.rows[0]?.forEach((_, i) => (sheet.getColumn(i + 1).width = 18));
  return workbook.xlsx.writeBuffer();
}
export const sampleCsv = compareCsv;

/** Scarica un file generato nel browser (Blob), senza rete. false se il browser non lo permette. */
export function downloadFile(name: string, data: ArrayBuffer | string, type: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}
/** Copia negli appunti; false se il browser non lo permette (la pagina mostra il testo da copiare a mano). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Alcuni browser lasciano la richiesta in sospeso: dopo 3 secondi si mostra il testo da copiare a mano.
    const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 3000));
    return await Promise.race([globalThis.navigator.clipboard.writeText(text).then(() => true as const), timeout]);
  } catch {
    return false;
  }
}
