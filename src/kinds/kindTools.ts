// WZ-2126 (livelli 3 e 4): strumenti comuni dei tipi di pagina «Documento da
// modello» e «Testo da appunti». Copia identica in shared/mockupKinds/kindTools.ts.
// Nessuna rete: la scrittura AI arriva dall'esterno come funzione (`ai.compose`
// del dispatcher), il prototipo pubblicato la collega al gateway dell'assistente.

/** Testi che l'assistente sa scrivere: istruzioni fisse sul gateway, qui solo i dati del modulo. */
export type KindWriteTask = "circolare" | "versione_breve" | "motivazione";
/** Testo scritto dall'assistente, oppure null (assistente assente o non disponibile: si usa la versione senza AI). */
export type KindWriter = (task: KindWriteTask, fields: Record<string, string>) => Promise<string | null>;

export const kindNoAiNotice = "Versione senza intelligenza artificiale: il testo è composto in modo semplice. Rileggilo e correggilo.";
export const kindAiNotice = "Testo scritto dall'intelligenza artificiale: può sbagliare, rileggilo sempre.";
export const kindAiUnavailable = "L'assistente non è disponibile in questo momento.";

/** Nome di file semplice: «determina-12-2026.html». */
export const kindFileName = (base: string, ext: string) =>
  base.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) + "." + ext;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Pagina HTML semplice, apribile con Word: un paragrafo per riga, nessuno script. */
export function kindHtmlDocument(title: string, text: string): string {
  const paragraphs = text.split("\n").map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p>&nbsp;</p>")).join("\n");
  return `<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:"Times New Roman",serif;font-size:12pt;line-height:1.4;max-width:42rem;margin:2rem auto}p{margin:0 0 .4em}</style></head><body>\n${paragraphs}\n</body></html>\n`;
}
