// Client tipizzato del gateway /mockup-agent/* (contratto: contract.ts, copia
// di shared/mockupAgent.ts). È l'unico punto del template che usa la rete, e
// solo verso l'origine del gateway fissata alla build (la stessa della CSP).
import {
  mockupAgentPolicy,
  mockupAgentRoutes,
  mockupAgentShouldFallback,
  type MockupAgentAskRequest,
  type MockupAgentAskResponse,
  type MockupAgentDocumentResponse,
  type MockupAgentError,
  type MockupAgentErrorCode,
  type MockupAgentManifestResponse,
  type MockupAgentReviewRequest,
  type MockupAgentReviewResponse,
  type MockupAgentRunRequest,
  type MockupAgentRunResponse,
} from "./contract.ts";
import { agentGatewayOrigin, validGatewayOrigin } from "./boot.ts";

export type GatewayFailure = {
  ok: false;
  /** Regola comune `mockupAgentShouldFallback`, oppure `fallback: true` nel corpo dell'errore. */
  fallback: boolean;
  status?: number;
  error?: MockupAgentErrorCode;
  message?: string;
  timedOut?: boolean;
};
export type GatewayResult<T> = { ok: true; data: T } | GatewayFailure;

export type GatewayClient = {
  manifest(): Promise<GatewayResult<MockupAgentManifestResponse>>;
  ask(body: MockupAgentAskRequest): Promise<GatewayResult<MockupAgentAskResponse>>;
  run(body: MockupAgentRunRequest): Promise<GatewayResult<MockupAgentRunResponse>>;
  /** WZ-2126: risposte proposte per una lista di controllo. */
  review(body: MockupAgentReviewRequest): Promise<GatewayResult<MockupAgentReviewResponse>>;
  document(file: { bytes: ArrayBuffer | Uint8Array; type: string; name: string }): Promise<GatewayResult<MockupAgentDocumentResponse>>;
  /** WZ-2126: testo breve di un tipo di pagina (compito chiuso, istruzioni sul gateway). */
  compose(body: MockupAgentComposeRequest): Promise<GatewayResult<MockupAgentComposeResponse>>;
};
export type MockupAgentComposeRequest = { task: "circolare" | "versione_breve" | "motivazione"; fields: Record<string, string>; requestKey: string };
export type MockupAgentComposeResponse = { text: string; remaining?: number };

export function createGatewayClient(options: {
  origin: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Un solo timeout per tutte le rotte (test); di norma 12 s per il manifesto e 45 s per le altre. */
  timeoutMs?: number;
  now?: () => number;
}): GatewayClient {
  if (!validGatewayOrigin(options.origin)) throw Error("mockup_agent_origin_invalid");
  // Con l'origine fissata alla build (config.json) il client parla solo con quella.
  if (agentGatewayOrigin && options.origin !== agentGatewayOrigin) throw Error("mockup_agent_origin_not_approved");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Date.now());
  // Manifesto: richiesta leggera (12 s). Domande, passi e documenti possono usare
  // il modello: si aspetta fino a 45 s, oltre il timeout del gateway (35 s).
  const timeoutFor = (route: string) => options.timeoutMs ?? (route === mockupAgentRoutes.manifest ? mockupAgentPolicy.fallbackAfterMs : mockupAgentPolicy.modelFallbackAfterMs);
  async function call<T>(route: string, body: BodyInit, headers: Record<string, string>): Promise<GatewayResult<T>> {
    const timeoutMs = timeoutFor(route);
    const controller = new AbortController();
    const started = now();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(options.origin + route, {
        method: "POST",
        body,
        headers: { Authorization: `Bearer ${options.token}`, ...headers },
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
      let parsed: unknown = null;
      try { parsed = await response.json(); } catch { parsed = null; }
      const valid = !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
      if (response.ok && valid) return { ok: true, data: parsed as T };
      const err = (valid ? parsed : {}) as Partial<MockupAgentError>;
      return {
        ok: false,
        status: response.status,
        fallback: err.fallback === true || mockupAgentShouldFallback({ status: response.status, invalid: response.ok && !valid, elapsedMs: now() - started, afterMs: timeoutMs }),
        ...(typeof err.error === "string" ? { error: err.error } : {}),
        ...(typeof err.message === "string" ? { message: err.message.slice(0, 400) } : {}),
      };
    } catch {
      return { ok: false, fallback: mockupAgentShouldFallback({ networkError: !timedOut, elapsedMs: timedOut ? timeoutMs : now() - started, afterMs: timeoutMs }), timedOut };
    } finally {
      clearTimeout(timer);
    }
  }
  const jsonHeaders = { "Content-Type": "application/json" };
  return {
    manifest: () => call(mockupAgentRoutes.manifest, "{}", jsonHeaders),
    ask: (body) => call(mockupAgentRoutes.ask, JSON.stringify(body), jsonHeaders),
    run: (body) => call(mockupAgentRoutes.run, JSON.stringify(body), jsonHeaders),
    review: (body) => call(mockupAgentRoutes.review, JSON.stringify(body), jsonHeaders),
    compose: (body) => call(mockupAgentRoutes.compose, JSON.stringify(body), jsonHeaders),
    document: (file) =>
      call(mockupAgentRoutes.document, new Blob([file.bytes as BlobPart], { type: file.type }), {
        "Content-Type": file.type,
        // Solo ASCII negli header: il nome serve al gateway per il tipo, non per l'utente.
        "X-File-Name": file.name.normalize("NFD").replace(/[^\x20-\x7e]/g, "_").slice(0, mockupAgentPolicy.documentFileNameMaxLength),
      }),
  };
}

/** Chiave di idempotenza: 16–80 caratteri `[a-zA-Z0-9-]` (`requestKeyPattern`). */
export function requestKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  let out = "";
  while (out.length < 24) out += Math.random().toString(36).slice(2);
  return out.slice(0, 24) + "-" + Date.now().toString(36);
}
