// WZ-2126: funzioni AI dei tipi di pagina, solo nel sito pubblicato. Passano
// dall'assistente del prototipo (gateway fissato alla build, token della
// sessione aperta da FlowareHub): crediti Floware, anonimizzazione dei dati
// personali e tetti anti-abuso sono quelli del gateway. Senza gateway o senza
// token restituisce undefined e i tipi di pagina usano la versione senza AI.
// Il client si carica solo al primo uso, fuori dal bundle iniziale.
import type { MockupKindAi } from "./index.tsx";

export function createKindAi(origin: string | null, token: string | null): MockupKindAi | undefined {
  if (!origin || !token) return undefined;
  const client = async () => {
    const { createGatewayClient, requestKey } = await import("../agent/gateway.ts");
    return { gateway: createGatewayClient({ origin, token }), requestKey };
  };
  return {
    review: async ({ items, text }) => {
      try {
        const { gateway, requestKey } = await client();
        const result = await gateway.review({ items, text, requestKey: requestKey() });
        return result.ok ? result.data.answers : null;
      } catch {
        return null;
      }
    },
    // WZ-2126 (livelli 3 e 4): circolare, versione breve e motivazione. Compito chiuso,
    // istruzioni sul gateway: da qui partono solo i dati del modulo.
    compose: async (task, fields) => {
      if (task !== "circolare" && task !== "versione_breve" && task !== "motivazione") return null;
      try {
        const { gateway, requestKey } = await client();
        const result = await gateway.compose({ task, fields, requestKey: requestKey() });
        return result.ok && typeof result.data.text === "string" && result.data.text.trim() ? result.data.text.trim() : null;
      } catch {
        return null;
      }
    },
  };
}
