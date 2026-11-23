// WZ-2126: tipi di pagina riutilizzabili. Una pagina con `kind` mostra il suo
// componente al posto delle sezioni generiche (indicatori, tabella, form).
// La specifica è già validata da parseMockupSpec (shared/mockups.ts) prima
// della build e dell'anteprima: qui si legge con prudenza, senza fidarsi dei tipi.
// Copia identica in shared/mockupKinds/index.tsx (anteprima di FlowareHub).
import type { ReactNode } from "react";
import { Checklist, type ChecklistReview } from "./Checklist";
import { Deadlines } from "./Deadlines";
import type { ChecklistConfig } from "./checklistLogic";
import type { DeadlinesConfig } from "./deadlinesLogic";
// WZ-2126 (livelli 4 e 3): documento da modello e testo da appunti.
import { DocumentKind } from "./Document";
import { ComposeKind } from "./Compose";
import type { DocumentConfig } from "./documentLogic";
import type { ComposeConfig } from "./composeLogic";
import { ComparePage } from "./Compare.tsx";

/** Funzioni AI offerte ai tipi di pagina; assenti senza assistente (anteprima, prototipo senza gateway). */
export type MockupKindAi = {
  review?: ChecklistReview;
  compose?: (task: string, fields: Record<string, string>) => Promise<string | null>;
};
export type MockupKindProps = {
  page: object;
  ai?: MockupKindAi;
  /** Chiave per la memoria del browser; senza chiave i dati restano solo in memoria. */
  storageKey?: string;
  /** Anteprima in modalità selezione: controlli visibili ma inattivi. */
  inert?: boolean;
};

export function mockupKindOf(page: object): string | undefined {
  const kind = Reflect.get(page, "kind");
  return typeof kind === "string" ? kind : undefined;
}
const configOf = <T,>(page: object, name: string): T | undefined => {
  const value = Reflect.get(page, name);
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : undefined;
};
type TablePage = { id: string; columns: string[]; rows: string[][] };

export function MockupKindPage({ page, ai, storageKey, inert }: MockupKindProps): ReactNode {
  const table = page as TablePage;
  switch (mockupKindOf(page)) {
    case "deadlines": {
      const config = configOf<DeadlinesConfig>(page, "deadlines");
      return config ? <Deadlines page={table} config={config} storageKey={storageKey} inert={inert} /> : null;
    }
    case "checklist": {
      const config = configOf<ChecklistConfig>(page, "checklist");
      return config ? <Checklist page={table} config={config} review={ai?.review} storageKey={storageKey} inert={inert} /> : null;
    }
    case "document": {
      const config = configOf<DocumentConfig>(page, "document");
      return config ? <DocumentKind page={table} config={config} writer={ai?.compose} storageKey={storageKey} inert={inert} /> : null;
    }
    case "compose": {
      const config = configOf<ComposeConfig>(page, "compose");
      return config ? <ComposeKind config={config} writer={ai?.compose} storageKey={storageKey} inert={inert} /> : null;
    }
    case "compare":
      // WZ-2126 (livello 2): il confronto legge da sé la configurazione; nessuna memoria del browser.
      return configOf(page, "compare") ? <ComparePage page={page} inert={inert} /> : null;
    default:
      return null;
  }
}
