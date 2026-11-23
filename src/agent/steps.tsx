// Elenco animato dei passi dell'agente: «in corso…», poi ✓ con durata, fonte
// ed eventuale etichetta «esempio preparato» (Decisione 1 del design).
import { useEffect, useState } from "react";
import type { StepView } from "./runtime";
import { formatDate, isNormattivaUrl } from "./compute";

/** Testo di avanzamento di un passo in corso dopo `elapsedMs`: i passi con il modello possono durare decine di secondi. */
export function runningText(elapsedMs: number, model?: boolean): string {
  const s = Math.floor(elapsedMs / 1000);
  if (s < 3) return " in corso…";
  if (!model) return ` in corso… ${s} s`;
  if (s < 15) return ` il modello sta lavorando… ${s} s`;
  return ` il modello sta ancora scrivendo… ${s} s (fino a 45 s, poi esempio preparato)`;
}
function Running({ startedAt, model }: { startedAt?: number; model?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-(--mk-muted)" data-testid="agent-step-progress">{runningText(startedAt === undefined ? 0 : now - startedAt, model)}</span>;
}

const seconds = (ms?: number) => (ms === undefined ? "" : ms < 1000 ? `${Math.max(ms, 1)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);

export function AgentSteps({ steps }: { steps: StepView[] }) {
  if (!steps.length) return null;
  return (
    <ol aria-label="Passi dell'assistente" className="grid gap-2" data-testid="agent-steps">
      {steps.map((s) => (
        <li
          key={s.id}
          data-status={s.status}
          className={`mk-step rounded-lg border border-(--mk-divider) px-3 py-2 text-sm ${s.status === "pending" ? "opacity-50" : ""}`}
        >
          <div className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {s.status === "running" ? (
                <span className="mk-spinner h-4 w-4 rounded-full border-2 border-(--mk-subtle) border-t-(--mk-primary)" />
              ) : s.status === "done" ? (
                <span className="font-bold text-(--mk-primary)">✓</span>
              ) : s.status === "error" ? (
                <span className="text-(--mk-danger)">!</span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-(--mk-border)" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {s.label}
                {s.status === "running" && <Running startedAt={s.startedAt} model={s.model} />}
              </p>
              {s.detail && s.status !== "running" && <p className="mt-0.5 text-(--mk-muted)">{s.detail}</p>}
              {s.citations?.map((c) => (
                <details key={c.itemKey} className="mt-1 text-xs">
                  <summary className="cursor-pointer text-(--mk-primary)">
                    Testo curato{c.verifiedAt ? ` · verificato il ${formatDate(c.verifiedAt)}` : ""}
                  </summary>
                  <div className="mt-1 grid gap-1 rounded-md bg-(--mk-subtle) p-2 text-(--mk-text)">
                    <p className="font-medium">{c.citation} · {c.title}</p>
                    <p className="whitespace-pre-line text-(--mk-muted)">{(c.text ?? c.summary ?? c.title).slice(0, 1200)}</p>
                    {isNormattivaUrl(c.url) && <a href={c.url} target="_blank" rel="noreferrer noopener" className="underline text-(--mk-primary)">Apri su Normattiva ↗</a>}
                  </div>
                </details>
              ))}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-(--mk-muted)">
              {s.status === "done" || s.status === "error" ? <span>{seconds(s.ms)}</span> : null}
              {s.prepared && (
                <span data-testid="agent-prepared" title="Risposta preparata in anticipo: il modello non ha risposto in tempo o il limite è esaurito. I calcoli restano veri." className="rounded-full border border-(--mk-border) px-2 py-0.5">
                  esempio preparato
                </span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
