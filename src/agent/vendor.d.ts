// Tipi minimi delle parti di exceljs e docx usate in files.ts. Le dichiarazioni
// ambient hanno la precedenza sui pacchetti: il renderer si controlla anche
// senza le due librerie installate (test di typecheck con i node_modules della
// root). Il comportamento reale è provato in scripts/mockup-agent-files.test.mjs.
declare module "exceljs" {
  export type CellValue = string | number | boolean | null | { formula: string; result?: number };
  export interface WorksheetView { state: "frozen"; ySplit?: number; xSplit?: number }
  export interface Row { font: { bold?: boolean }; getCell(index: number): { numFmt: string; value: CellValue }; values: CellValue[] }
  export interface Column { width: number; numFmt: string }
  export interface Worksheet {
    name: string;
    views: WorksheetView[];
    rowCount: number;
    addRow(values: CellValue[]): Row;
    getRow(index: number): Row;
    getColumn(index: number): Column;
    getCell(ref: string): { value: CellValue };
  }
  export class Workbook {
    creator: string;
    created: Date;
    worksheets: Worksheet[];
    addWorksheet(name: string, options?: { views?: WorksheetView[] }): Worksheet;
    getWorksheet(name: string): Worksheet | undefined;
    xlsx: { writeBuffer(): Promise<ArrayBuffer>; load(data: ArrayBuffer): Promise<Workbook> };
  }
}
declare module "docx" {
  type Alignment = "center" | "left" | "both";
  export const AlignmentType: { CENTER: Alignment; LEFT: Alignment; JUSTIFIED: Alignment };
  export const HeadingLevel: { HEADING_2: string };
  export class TextRun {
    constructor(options: string | { text: string; bold?: boolean; italics?: boolean; size?: number; style?: string });
  }
  export class ExternalHyperlink {
    constructor(options: { link: string; children: TextRun[] });
  }
  export class Paragraph {
    constructor(options: {
      text?: string;
      alignment?: Alignment;
      heading?: string;
      spacing?: { before?: number; after?: number };
      bullet?: { level: number };
      children?: (TextRun | ExternalHyperlink)[];
    });
  }
  export class Document {
    constructor(options: { creator?: string; title?: string; sections: { children: Paragraph[] }[] });
  }
  export const Packer: { toBlob(doc: Document): Promise<Blob>; toBuffer(doc: Document): Promise<Uint8Array> };
}
