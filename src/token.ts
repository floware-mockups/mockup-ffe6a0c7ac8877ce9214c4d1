// v7 (WZ-2123): il token dell'assistente (#fa=<token>) si toglie dall'indirizzo prima
// che si carichi qualunque altro modulo, componenti su misura compresi: main.tsx
// importa questo file per primo. Il token resta solo in memoria.
import { captureAgentToken } from "./agent/boot.ts";

export const agentToken = captureAgentToken(location, history);
