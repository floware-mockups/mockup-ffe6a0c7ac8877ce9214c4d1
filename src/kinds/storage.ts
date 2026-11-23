// WZ-2126: memoria facoltativa dei tipi di pagina nel browser. Ogni accesso è
// in try/catch: senza localStorage (navigazione privata, blocchi) la pagina
// funziona lo stesso, con i dati solo in memoria.
// Copia identica in shared/mockupKinds/storage.ts.
const prefix = "floware-kind:";

/** Chiave legata alla pagina e al suo contenuto: una nuova versione riparte dai suoi dati. */
export function kindStorageKey(page: object): string {
  const text = JSON.stringify(page);
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  return `${prefix}${String(Reflect.get(page, "id") ?? "")}:${(hash >>> 0).toString(36)}`;
}
export function loadKindState(key: string | undefined, name: string): unknown {
  if (!key) return null;
  try {
    const raw = globalThis.localStorage?.getItem(`${key}:${name}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function saveKindState(key: string | undefined, name: string, value: unknown) {
  if (!key) return;
  try {
    globalThis.localStorage?.setItem(`${key}:${name}`, JSON.stringify(value));
  } catch {
    /* memoria del browser non disponibile: si resta in memoria */
  }
}
/** «Ripristina demo»: dimentica tutto ciò che i tipi di pagina hanno salvato. */
export function clearKindStates() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* niente da pulire */
  }
}
/** Copia negli appunti; false se il browser non lo permette (la pagina mostra il testo da copiare a mano). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
/** Scarica un file generato nel browser (Blob), senza rete. */
export function downloadText(name: string, text: string, type: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
