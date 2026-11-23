// WZ-2123: registro dei componenti su misura. Nel template è vuoto; la
// pubblicazione lo riscrive con i componenti della specifica (src/custom/<Nome>.tsx).
import type { ComponentType } from "react";
// Ogni componente ha le props del suo ruolo (vedi src/floware.tsx): qui conta solo il nome.
export const customComponents: Record<string, ComponentType<never>> = {};
// La pubblicazione la riscrive per caricare i componenti subito dopo l'avvio.
export const preloadCustomComponents = () => undefined;
