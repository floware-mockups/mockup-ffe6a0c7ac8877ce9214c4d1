// v7 (WZ-2123): congelamento degli oggetti di base del linguaggio raggiungibili dal codice
// dei componenti su misura (Object, Array, Promise, JSON, Intl…, con i loro prototipi),
// prima che si carichi il primo componente: nessuno può sostituire push, then o
// JSON.stringify per intercettare ciò che passa nel codice del template o di React.
// Lo usa src/customGuard.ts. Modulo senza import: si prova da solo in un realm separato
// (scripts/mockup-custom-guard.test.mjs).
//
// Fallisce chiuso: se il congelamento si interrompe a metà, l'errore resta memorizzato e
// ogni chiamata successiva lo rilancia; customGuard.ts allora non carica alcun componente.

let state: { done: true } | { failed: Error } | null = null;

// Proprietà che il codice comune riassegna sulle istanze (e.name = …, o.toString = …,
// P.prototype.constructor = …): con il prototipo congelato l'assegnazione fallirebbe
// (override mistake), quindi diventano accessor che creano la proprietà sull'istanza.
// Sul prototipo stesso la scrittura si ignora: core-js (dentro exceljs) riassegna
// Function.prototype.toString al caricamento e non deve fermarsi; il valore resta quello nativo.
function allowOverrides(proto: object, keys: readonly PropertyKey[] | "*") {
  for (const key of keys === "*" ? Reflect.ownKeys(proto) : keys) {
    const desc = Reflect.getOwnPropertyDescriptor(proto, key);
    if (!desc || !("value" in desc) || !desc.configurable) continue;
    const value: unknown = desc.value;
    Object.defineProperty(proto, key, {
      get() {
        return value;
      },
      set(this: object, next: unknown) {
        if (this === proto) return;
        Object.defineProperty(this, key, { value: next, writable: true, enumerable: true, configurable: true });
      },
      enumerable: desc.enumerable,
      configurable: false,
    });
  }
}

function freezeIntrinsics() {
  const g = globalThis as unknown as Record<string, unknown>;
  const errors = [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError, g.AggregateError].filter(
    (e): e is ErrorConstructor => typeof e === "function",
  );
  // React imposta Error.prepareStackTrace per le sue tracce: diventa un accessor che
  // ignora le scritture, così nessuno installa un proprio formattatore.
  try {
    Object.defineProperty(Error, "prepareStackTrace", { get: () => undefined, set: () => undefined, enumerable: false, configurable: false });
  } catch {
    // già definito dal browser: resta com'è e viene congelato sotto.
  }
  const generator = Object.getPrototypeOf(function* () {}) as object;
  const iteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object;
  allowOverrides(Object.prototype, "*");
  allowOverrides(Function.prototype, ["constructor", "bind", "toString"]);
  for (const e of errors) allowOverrides(e.prototype, ["constructor", "message", "name", "toString"]);
  allowOverrides(Promise.prototype, ["constructor"]);
  allowOverrides(Array.prototype, ["constructor", "toString"]);
  // core-js controlla String#includes assegnando regexp[Symbol.match] = false su un'istanza.
  allowOverrides(RegExp.prototype, [Symbol.match, Symbol.matchAll, Symbol.replace, Symbol.search, Symbol.split, "constructor", "toString"]);
  allowOverrides(generator, ["constructor", "toString"]);
  allowOverrides(iteratorPrototype, ["toString"]);

  const roots: unknown[] = [
    Object, Function, Array, String, Number, Boolean, Symbol, Math, JSON, Date, RegExp, Map, Set, Promise, Intl,
    g.BigInt, g.Iterator, ...errors,
    // Prototipi raggiungibili solo dalle istanze.
    [][Symbol.iterator](), new Map().entries(), new Set().values(), ""[Symbol.iterator](), /x/[Symbol.matchAll]("x"),
    generator, Object.getPrototypeOf(async function () {}), Object.getPrototypeOf(async function* () {}),
  ];
  // Lasciato scrivibile: lo usano i polyfill (core-js dentro exceljs) e conta solo per `with`,
  // che il codice generato non può usare.
  const keepWritable = new Set<unknown>([Reflect.get(Array.prototype, Symbol.unscopables)]);
  // Symbol: proprietà bloccate ma oggetto estendibile, perché core-js (dentro exceljs)
  // aggiunge Symbol.useSetter e Symbol.useSimple al caricamento. Aggiungere proprietà a
  // Symbol non dà accesso a nulla (instanceof Symbol non si usa nel template).
  const lockOnly = new Set<unknown>([Symbol]);
  const seen = new Set<unknown>();
  const stack = [...roots];
  while (stack.length) {
    const value = stack.pop();
    if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value) || keepWritable.has(value)) continue;
    // Mai la finestra: non è un oggetto di base e non è raggiungibile dal codice generato.
    if (value === globalThis) continue;
    seen.add(value);
    stack.push(Object.getPrototypeOf(value));
    for (const key of Reflect.ownKeys(value)) {
      const desc = Reflect.getOwnPropertyDescriptor(value, key);
      if (!desc) continue;
      if ("value" in desc) stack.push(desc.value);
      else stack.push(desc.get, desc.set);
    }
    if (!lockOnly.has(value)) {
      Object.freeze(value);
      continue;
    }
    for (const key of Reflect.ownKeys(value)) {
      const desc = Reflect.getOwnPropertyDescriptor(value, key);
      if (desc?.configurable) Object.defineProperty(value, key, "value" in desc ? { writable: false, configurable: false } : { configurable: false });
    }
  }
}

/** Congela gli oggetti di base. Idempotente; se una volta non riesce, non riesce più. */
export function hardenIntrinsics() {
  if (state && "done" in state) return;
  if (state) throw state.failed;
  try {
    freezeIntrinsics();
    state = { done: true };
  } catch (error) {
    state = { failed: error instanceof Error ? error : new Error(String(error)) };
    throw state.failed;
  }
}

/** Errore del congelamento, se c'è stato (diagnostica e test). */
export function hardeningFailure(): Error | null {
  return state && "failed" in state ? state.failed : null;
}
