// Parte dell'agente caricata all'avvio insieme al prototipo: lettura del token,
// origine del gateway fissata alla build e aggiunta di un record alla tabella.
// Non importa il contratto (contract.ts) per non appesantire il bundle iniziale:
// il pannello vero si carica a parte (AgentPanel.tsx, import dinamico).
import config from "./config.json";

export const gatewayOriginPattern = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)?\.convex\.site$/;
// 127.0.0.1 solo per la pagina di prova locale (scripts/mockup-agent-demo.mjs):
// la build del servizio accetta soltanto *.convex.site (mockup-template.mjs).
const loopbackPattern = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
export const validGatewayOrigin = (o: unknown): o is string => typeof o === "string" && (gatewayOriginPattern.test(o) || loopbackPattern.test(o));
/** Origine del gateway fissata alla build; null = template senza assistente. */
export const agentGatewayOrigin: string | null = validGatewayOrigin(config.gatewayOrigin) ? config.gatewayOrigin : null;

/** Copia di `mockupAgentTokenPattern` del contratto (un test le confronta). */
export const agentTokenPattern = /^[A-Za-z0-9_-]{43}$/;

/**
 * Legge `#fa=<token>` e lo toglie subito dall'indirizzo (history.replaceState),
 * prima che il prototipo legga l'hash per la navigazione. Il token resta solo in memoria.
 */
export function captureAgentToken(loc: Pick<Location, "hash" | "pathname" | "search">, hist: Pick<History, "replaceState">): string | null {
  const match = /^#fa=([^&]*)$/.exec(loc.hash);
  if (!match) return null;
  hist.replaceState(null, "", loc.pathname + loc.search);
  return agentTokenPattern.test(match[1]) ? match[1] : null;
}

const key = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const sameColumn = (a: string, b: string) => key(a) === key(b) || key(a).startsWith(key(b)) || key(b).startsWith(key(a));

type PageLike = { columns: string[]; rows: string[][] };
/**
 * Aggiunge un record dell'agente (etichetta → valore) in cima alla pagina le cui
 * colonne corrispondono di più alle etichette. pageIndex -1 = nessuna pagina adatta.
 */
export function addAgentRecord<P extends PageLike>(pages: P[], record: Record<string, string>): { pages: P[]; pageIndex: number } {
  const labels = Object.keys(record);
  let best = -1, score = 0;
  pages.forEach((p, i) => {
    const s = p.columns.filter((c) => labels.some((l) => sameColumn(l, c))).length;
    if (s > score) { score = s; best = i; }
  });
  if (best < 0) return { pages, pageIndex: -1 };
  const row = pages[best].columns.map((c) => {
    const label = labels.find((l) => sameColumn(l, c));
    return label ? record[label] : "—";
  });
  return { pages: pages.map((p, i) => (i === best ? { ...p, rows: [row, ...p.rows] } : p)), pageIndex: best };
}
