# Prototipo pubblico Floware

Interfaccia dimostrativa React/TypeScript/Vite/Tailwind. Tutti i dati sono sintetici.
Nessun backend né autenticazione propri. L'unica connessione è quella dell'assistente
(`src/agent/`) verso il gateway Floware fissato alla build, e solo se il prototipo è
aperto da FlowareHub; senza, l'assistente resta spento e il prototipo funziona come prima.
Non inserire dati personali o riservati. I dati inseriti restano in memoria e scompaiono al reload.

Con Node 24: `npm ci`, `npm run dev` oppure `npm run build`.
La specifica delle schermate è `src/spec.json`; il renderer e le dipendenze sono controllati dal template `mockup-v1`.
