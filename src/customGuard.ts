// v7 (WZ-2123): difese a runtime dei componenti su misura (src/custom/). Il controllo
// statico di Floware (convex/lib/mockupCustomCode.ts) resta il primo filtro; queste
// difese reggono anche se una sua regola avesse un buco.
//
// 1. Gli oggetti di base del linguaggio raggiungibili dal codice generato si congelano
//    prima che si carichi il primo componente (src/harden.ts). Se il congelamento non
//    riesce, nessun componente si carica (fallisce chiuso).
// 2. Ciò che un componente restituisce si ricostruisce qui con un elenco chiuso di tag
//    e di proprietà: niente ref, gestori del browser, href/src, HTML grezzo, anche se
//    il codice altera o falsifica gli oggetti JSX.
// 3. Le funzioni scritte dal modello non diventano mai tipi React: le chiama un
//    involucro di questo modulo, come funzioni semplici.
// 4. Watchdog: il codice generato che gira troppo a lungo si ferma (vedi la sezione 5).
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import { Badge, Button, Card, Checkbox, Dialog, Drawer, Field, Select, TextArea, TextInput, customComponentStopped, stopCustomComponent, subscribeCustomStops } from "./floware.tsx";
import { hardenIntrinsics } from "./harden.ts";
import seed from "./spec.json";

type Props = Record<string, unknown>;

// --- Testi da phishing -----------------------------------------------------------------
// Ogni testo che un componente mostra si normalizza in un alfabeto chiuso (larghezza
// intera, accenti, caratteri invisibili, lettere di altri alfabeti che sembrano latine,
// cifre al posto delle lettere, lettere spaziate, trattini e punti dentro le parole) e si
// confronta con le parole di un modulo di accesso o di pagamento: ogni testo da solo
// (diventa «—», sanitize) e, dopo il rendering, il testo completo di ogni riquadro anche
// ricomposto da più pezzi (il componente si esclude, customTextsPhishing). Le stesse regole
// valgono nel controllo statico (shared/mockupCustomCheck.ts, verificato da test).
// Caratteri invisibili, come intervalli di codici (U+00AD trattino morbido, U+034F, U+061C,
// U+115F-1160 e U+3164 riempitivi hangul, U+17B4-17B5, U+180B-180E e U+FE00-FE0F selettori di
// variante, U+200B-200F spazi di larghezza zero e segni di direzione, U+202A-202E, U+2060-206F,
// U+FEFF): numeri e non un'espressione regolare, che li mostrerebbe come caratteri veri.
const invisibleRanges = [[173,173],[847,847],[1564,1564],[4447,4448],[6068,6069],[6155,6158],[8203,8207],[8234,8238],[8288,8303],[12644,12644],[65024,65039],[65279,65279]];
const invisible = (code: number) => invisibleRanges.some(([from, to]) => code >= from && code <= to);
// Lettere che sembrano latine (cirillico, greco, maiuscoletto, ı turca, ł, ø…) → latine.
const confusableChars = "аaвbеeкkмmнhоoрpсcтtуyхxѕsіiјjԁdԛqԝwһhӏlɡgпnαaβbγyδdεeζzηnιiκkμuνvοoρpσoςsτtυuχxωwıiłløođdħhŧtȷjǀlᴀaʙbᴄcᴅdᴇeꜰfɢgʜhɪiᴊjᴋkʟlᴍmɴnᴏoᴘpʀrꜱsᴛtᴜuᴠvᴡwʏyᴢz";
const leetChars = "0o1i3e4a5s7t@a$s|l€e";
// Alfabeto chiuso: restano solo lettere latine senza accenti, cifre e spazi. Trattini,
// punti, sottolineature e simili si tolgono (log-in, log.in, log_in → login), apostrofi,
// virgolette e punteggiatura diventano spazi, tutto il resto (altri alfabeti, simboli,
// emoji) si toglie.
const joinChars = "-._·•*|/\\~^‐‑‒–—―‧∙⋅";
const spaceChars = "'’‘`´\"«»“”„,;:!?()[]{}<>=+&%#@$";
const phishingText = /\b(?:password|passwd|passcode|pass ?word|pass ?phrase|parol[ae] d ?ordine|parola (?:chiave|segreta)|pin|otp|cvv2?|cvc|carta di credito|carte di credito|card ?number|numero (?:della |di )?carta(?! d ?identita)|codice (?:della )?carta(?! d ?identita)|security ?code|codice (?:monouso|di verifica|di sicurezza|segreto|otp|personale|di accesso)|verification ?code|one ?time (?:code|password|pin)|iban|credenzial[ei]|credentials?|accedi|(?:dati|credenziali|nome utente|password|pin) (?:di|d|per l ?) ?accesso|(?:effettua|esegui|fai|completa|ripeti) l ?accesso|accesso (?:al|all|alla|ai|alle) (?:tuo|tua|tuoi|tue|vostro|vostra|conto|account|area riservata|home banking)|accesso riservato|area riservata|log ?in|log ?on|sign ?(?:in|on)|nome utente|user ?name|chiave (?:personale|segreta|privata|di accesso)|secret ?key|private ?key|seed ?phrase|recovery ?phrase|frase (?:segreta|di recupero)|identificati (?:con|tramite|ora|qui|subito|per)|identificarti|autenticati|autenticarsi|autenticazione (?:a due fattori|forte|con|tramite)|(?:verifica|conferma|dimostra) (?:la tua |l )?identita|identita digitale|(?:verifica|conferma|riattiva|sblocca) (?:il tuo |l )?account|your account|entra con|2fa|mfa|spid|cie|token (?:di accesso|di sicurezza|otp|monouso|personale|segreto)|(?:il tuo|inserisci il|codice) token|sessione (?:e )?scadut[ao]|session expired|inserisci (?:il tuo|la tua|i tuoi|le tue)|enter your)\b/;
// Parole lunghe e senza ambiguità, cercate anche a testo tutto attaccato (pezzi separati,
// lettere spaziate); mai parole corte che stanno dentro altre (design → «signin» no).
const phishingSquashed = /password|passwd|passcode|passphrase|credenzial|credential|cartadicredito|cartedicredito|cardnumber|numerodellacarta(?!didentita)|securitycode|codicemonouso|codicediverifica|codicedisicurezza|codicediaccesso|verificationcode|onetimecode|onetimepassword|chiavesegreta|chiavepersonale|chiaveprivata|secretkey|privatekey|seedphrase|recoveryphrase|frasesegreta|frasedirecupero|sessionescadut|sessioneescadut|sessionexpired|inseriscilatua|inserisciiltuo|inserisciituoi|inseriscituoi|inserisciletue|verificalatuaidentita|confermalatuaidentita|verificailtuoaccount|entraconiltuo|identitadigitale|nomeutente|username|areariservata|datidiaccesso|credenzialidiaccesso|effettualaccesso|eseguilaccesso/;
// «Identificati» da solo, come pulsante o titolo (non «contribuenti identificati: 12»).
const phishingEnd = /(?:^| )identificati$/;

/** Testo nell'alfabeto chiuso, senza togliere gli spazi ai bordi (per i pezzi di un riquadro). */
function foldRaw(text: string, leet: boolean): string {
  const base = String(text).normalize("NFKC").toLowerCase().normalize("NFD");
  const map = leet ? confusableChars + leetChars : confusableChars;
  let out = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    // Caratteri invisibili e segni combinanti (accenti) via.
    if (invisible(code) || (code >= 768 && code <= 879)) continue;
    const i = map.indexOf(ch);
    const c = i >= 0 && i % 2 === 0 ? map[i + 1] : ch;
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) out += c;
    else if (joinChars.includes(c)) continue;
    else if (spaceChars.includes(c) || c.trim() === "") out += " ";
  }
  // Lettere singole separate da spazi («p a s s w o r d») accorpate.
  return out.replace(/ +/g, " ").replace(/\b(?:[a-z0-9] ){2,}[a-z0-9]\b/g, (m) => m.replace(/ /g, ""));
}
function foldText(text: string, leet: boolean): string {
  return foldRaw(text, leet).trim();
}
/** Vero se il testo, normalizzato, contiene parole di un modulo di accesso o di pagamento. */
export function phishingIn(text: string): boolean {
  for (const leet of [false, true]) {
    const folded = foldText(text, leet);
    if (phishingText.test(folded) || phishingEnd.test(folded) || phishingSquashed.test(folded.replace(/[^a-z0-9]/g, ""))) return true;
  }
  return false;
}

/** Pezzo di testo di un riquadro, nell'ordine della pagina; `exempt` per i testi del prototipo. */
export type TextSegment = { text: string; exempt: boolean };
const phishingTextAll = new RegExp(phishingText.source, "g");
const phishingSquashedAll = new RegExp(phishingSquashed.source, "g");
const singleLetters = /\b(?:[a-z0-9] ){2,}[a-z0-9]\b/g;
// Una parola trovata conta se almeno un suo carattere viene da un testo del componente:
// quelle che stanno tutte nei testi del prototipo (una colonna «IBAN») restano.
function matchedOutsideData(re: RegExp, text: string, owners: readonly number[], segments: readonly TextSegment[]) {
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    for (let k = start; k < start + m[0].length; k++) if (owners[k] >= 0 && !segments[owners[k]].exempt) return true;
  }
  return false;
}
/**
 * Vero se il testo completo di un riquadro, composto dai suoi pezzi nell'ordine (per
 * esempio <span>Pass</span><span>word</span>, {"Log"}{"-"}{"in"} o lettere una per una),
 * contiene parole di un modulo di accesso o di pagamento.
 */
export function phishingInSegments(segments: readonly TextSegment[]): boolean {
  for (const leet of [false, true]) {
    let text = "";
    let owners: number[] = [];
    for (const [index, segment] of segments.entries()) {
      const folded = foldRaw(segment.text, leet);
      if (!segment.exempt && phishingEnd.test(folded.trim())) return true;
      for (const ch of folded) {
        if (ch === " " && (text.endsWith(" ") || !text)) continue;
        text += ch;
        owners.push(index);
      }
    }
    // Lettere singole separate da spazi anche fra pezzi diversi.
    let joined = "";
    const joinedOwners: number[] = [];
    let last = 0;
    for (const m of text.matchAll(singleLetters)) {
      const start = m.index ?? 0;
      for (let k = last; k < start; k++) {
        joined += text[k];
        joinedOwners.push(owners[k]);
      }
      for (let k = start; k < start + m[0].length; k++)
        if (text[k] !== " ") {
          joined += text[k];
          joinedOwners.push(owners[k]);
        }
      last = start + m[0].length;
    }
    for (let k = last; k < text.length; k++) {
      joined += text[k];
      joinedOwners.push(owners[k]);
    }
    text = joined;
    owners = joinedOwners;
    if (matchedOutsideData(phishingTextAll, text, owners, segments)) return true;
    let squashed = "";
    const squashedOwners: number[] = [];
    for (let k = 0; k < text.length; k++)
      if (text[k] !== " ") {
        squashed += text[k];
        squashedOwners.push(owners[k]);
      }
    if (matchedOutsideData(phishingSquashedAll, squashed, squashedOwners, segments)) return true;
  }
  return false;
}

// I testi del prototipo stesso (titoli, colonne, righe, indicatori) restano come sono: li
// mostra già il template e sono passati dai controlli della specifica (per esempio una
// colonna «IBAN» con codici mascherati o la «Carta d'identità» fra i documenti).
const prototypeTexts = new Set<string>();
const collectTexts = (value: unknown): void => {
  if (typeof value === "string") prototypeTexts.add(foldText(value, false));
  else if (Array.isArray(value)) value.forEach(collectTexts);
  else if (value && typeof value === "object") Object.values(value).forEach(collectTexts);
};
collectTexts([Reflect.get(seed, "title"), Reflect.get(seed, "description"), Reflect.get(seed, "pages")]);
const reported = new Set<string>();
/** Attributi che il browser mostra come testo (suggerimenti, etichette, segnaposto). */
export const customTextAttributes = ["title", "aria-label", "aria-description", "aria-placeholder", "aria-roledescription", "placeholder", "alt"];
/**
 * Vero se i testi mostrati nei nodi (il riquadro di un componente e le sue finestre),
 * presi tutti insieme nell'ordine della pagina, sono da modulo di accesso o di pagamento.
 * Gli attributi di testo si controllano uno per uno.
 */
export function customTextsPhishing(roots: Iterable<Node>): boolean {
  const segments: TextSegment[] = [];
  const attributes: string[] = [];
  const exempt = (text: string) => prototypeTexts.has(foldText(text, false));
  for (const root of roots) {
    const walker = (root.ownerDocument ?? document).createTreeWalker(root, 0x1 | 0x4);
    for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === 3) {
        const text = node.nodeValue ?? "";
        if (text) segments.push({ text, exempt: exempt(text) });
      } else if (node.nodeType === 1)
        for (const name of customTextAttributes) {
          const value = (node as Element).getAttribute(name);
          if (value && !exempt(value)) attributes.push(value);
        }
    }
    segments.push({ text: " ", exempt: true });
  }
  return phishingInSegments(segments) || attributes.some(phishingIn);
}

/** Testo reso da un componente: «—» al posto di un testo da modulo di accesso o pagamento. */
export function safeText(text: string): string {
  if (!phishingIn(text) || prototypeTexts.has(foldText(text, false))) return text;
  if (reported.size < 50 && !reported.has(text)) {
    reported.add(text);
    console.warn("[floware] testo di un componente su misura sostituito: parole da modulo di accesso o di pagamento");
  }
  return "—";
}

// --- 2. Uscita dei componenti ricostruita --------------------------------------------

const elementTags = new Set<unknown>([Symbol.for("react.transitional.element"), Symbol.for("react.element")]);
// Gli stessi tag del controllo statico: nessuno carica risorse, naviga o esegue codice.
export const customAllowedTags = new Set([
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "strong", "em", "b", "i",
  "small", "mark", "s", "u", "sub", "sup", "br", "hr", "section", "article", "aside", "header", "footer", "nav", "main",
  "figure", "figcaption", "blockquote", "code", "pre", "time", "abbr", "address", "details", "summary", "progress", "meter",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "defs",
  "linearGradient", "radialGradient", "stop", "clipPath",
]);
// Attributi mai ammessi sui tag: risorse esterne, navigazione, HTML grezzo, riferimenti al DOM.
const deniedDomProps = new Set([
  "ref", "key", "href", "xlinkHref", "xlink:href", "src", "srcSet", "srcset", "action", "formAction", "data", "poster", "ping", "background",
  "dangerouslySetInnerHTML", "srcDoc", "srcdoc", "manifest", "codebase", "archive", "lowsrc", "dynsrc", "is", "itemType",
]);
// Attributi che contengono id: prefissati come gli id, così un componente non copre
// i nomi globali della pagina (window.<id>) e i riferimenti restano coerenti.
const idProps = new Set([
  "id", "htmlFor", "headers", "form", "list", "popoverTarget",
  "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-details", "aria-errormessage", "aria-flowto",
]);
const idPrefix = "mk-";
const prefixIds = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.startsWith(idPrefix) ? token : idPrefix + token))
    .join(" ");
const unsafeText = /javascript:|vbscript:/i;
const unsafeStyle = /url\(|src\(|image-set\(|image\(|element\(|cross-fade\(|paint\(|expression\(|@import|javascript:|\\/i;
// Colori: le stesse regole del controllo statico (convex/lib/mockupCustomCode.ts, verificato da
// test). Solo token del tema, così il contrasto resta quello verificato anche per i valori calcolati.
const colorOnlyStyle = /^(?:color|backgroundColor|borderColor|border(?:Top|Right|Bottom|Left|Block|Inline)(?:Start|End)?Color|outlineColor|fill|stroke|caretColor|accentColor|textDecorationColor|textEmphasisColor|columnRuleColor|stopColor|floodColor|lightingColor|scrollbarColor)$/;
const colorShorthandStyle = /^(?:background|backgroundImage|border(?:Top|Right|Bottom|Left|Block|Inline)?(?:Start|End)?|outline|boxShadow|textShadow|textDecoration|textEmphasis|columnRule|filter|backdropFilter|mask|maskImage|listStyle|listStyleImage|borderImage|content|cursor)$/;
const themeColorStyle = /^\s*(?:var\(--mk-[a-z-]+\)|transparent|currentColor|inherit|initial|unset|none)?\s*$/i;
const handColorStyle = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color|color-mix|light-dark|url|src|image-set|image|element|cross-fade|paint)\(|\b(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen|canvas|canvastext|linktext|visitedtext|activetext|buttonface|buttontext|buttonborder|field|fieldtext|highlight|highlighttext|selecteditem|selecteditemtext|mark|marktext|graytext|accentcolor|accentcolortext)\b/i;

// Un componente non si posiziona sopra la pagina: niente fixed o sticky, z-index al massimo
// 40 (sotto le finestre dell'API). Gli elementi fissi li mette il template. Niente misure
// legate allo schermo (100vw, 100vh…) né inset: un componente non diventa grande come la
// pagina (le stesse regole nel controllo statico, verificato da test).
const maxZIndex = 40;
const viewportUnit = /\d\s*[dsl]?v(?:w|h|i|b|min|max)\b/i;
const insetStyle = /^inset/i;
const screenClass = /^(?:(?:min-|max-)?[wh]|size)-(?:screen|[dsl]v[wh])$|^-?inset(?:-[xy])?-|\[[^\]]*\d\s*[dsl]?v(?:w|h|i|b|min|max)/;
const zIndexAllowed = (value: unknown) => {
  if (typeof value === "string" && /^\s*(?:auto|inherit|initial|unset)\s*$/i.test(value)) return true;
  const z = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(z) && z <= maxZIndex;
};

function sanitizeStyle(value: unknown): Record<string, string | number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(value as Props)) {
    // Niente variabili CSS (ridefinirebbero i token del tema) né cssText (scavalca ogni regola).
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(key) || key === "cssText") continue;
    if (key === "zIndex" && !zIndexAllowed(raw)) continue;
    if (key === "position" && (typeof raw !== "string" || /fixed|sticky/i.test(raw))) continue;
    if (insetStyle.test(key) || (typeof raw === "string" && viewportUnit.test(raw))) continue;
    if (typeof raw === "number") {
      if (Number.isFinite(raw) && !colorOnlyStyle.test(key)) out[key] = raw;
      continue;
    }
    if (typeof raw !== "string" || raw.length > 500 || unsafeStyle.test(raw)) continue;
    if (colorOnlyStyle.test(key) && !themeColorStyle.test(raw)) continue;
    if (colorShorthandStyle.test(key) && handColorStyle.test(raw.replace(/var\(--mk-[a-z-]+\)/g, ""))) continue;
    out[key] = raw;
  }
  return out;
}

// Classi: si tolgono solo quelle che posizionerebbero il componente sopra la pagina (fixed,
// sticky, z-index sopra 40), anche con varianti (md:fixed) o !important; le altre restano.
function safeClassName(value: string): string {
  return value
    .split(/\s+/)
    .filter((token) => {
      if (!token || token.length > 160) return false;
      const base = token.replace(/^(?:[^:]*:)*!?/, "").replace(/!$/, "");
      if (/^(?:fixed|sticky)$/.test(base) || screenClass.test(base)) return false;
      const z = /^-?z-(.+)$/.exec(base);
      return !z || z[1] === "auto" || (/^\d+$/.test(z[1]) && Number(z[1]) <= maxZIndex);
    })
    .join(" ");
}

function domProps(source: Props, depth: number, svg: boolean): Props {
  const out: Props = {};
  for (const [name, value] of Object.entries(source)) {
    if (name === "children") {
      out.children = sanitize(value, depth + 1, svg);
      continue;
    }
    if (name === "className") {
      if (typeof value === "string" && value.length <= 4000) {
        const cls = safeClassName(value);
        if (cls) out.className = cls;
      }
      continue;
    }
    // Anche le varianti con prefisso (xlink:href, xml:base…): niente attributi con «:» né *href.
    if (deniedDomProps.has(name) || /^on/i.test(name) || name.includes(":") || /href$/i.test(name)) continue;
    // Niente campi finti: testo modificabile o ruoli da casella di testo.
    if (/^contenteditable$/i.test(name) || name === "suppressContentEditableWarning") continue;
    if (name === "role" && typeof value === "string" && /^(?:textbox|combobox|searchbox|spinbutton)$/i.test(value.trim())) continue;
    if (name === "style") {
      const style = sanitizeStyle(value);
      if (style) out.style = style;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      if (typeof value === "boolean" || Number.isFinite(value)) out[name] = value;
      continue;
    }
    if (typeof value !== "string" || value.length > 4000 || unsafeText.test(value)) continue;
    if (idProps.has(name)) {
      out[name] = prefixIds(value);
      continue;
    }
    // Suggerimenti (title), etichette ARIA e simili: lo stesso controllo dei testi.
    const text = safeText(value);
    // url(#id) nei riferimenti SVG (fill, clipPath…) resta locale, con lo stesso prefisso degli
    // id; ogni altro url( no.
    const localRef = /url\(\s*#([A-Za-z0-9_.-]+)\s*\)/g;
    if (/url\(/i.test(text.replace(localRef, ""))) continue;
    out[name] = text.replace(localRef, (_, id: string) => `url(#${id.startsWith(idPrefix) ? id : idPrefix + id})`);
  }
  return out;
}

// Componenti dell'API: chiamano i gestori con valori semplici (vedi src/floware.tsx). Per
// ognuno solo le sue proprietà, con i valori ammessi: niente campi password, pulsanti
// submit o varianti inventate.
type ApiRule = Record<string, "node" | "handler" | "text" | "flag" | "options" | "rows" | readonly string[]>;
const apiRules = new Map<unknown, ApiRule>([
  [Button, { children: "node", onClick: "handler", variant: ["primary", "secondary", "danger", "link"], disabled: "flag", title: "text", autoFocus: "flag" }],
  [TextInput, { label: "text", value: "text", onChange: "handler", placeholder: "text", type: ["text", "number", "date"] }],
  [TextArea, { label: "text", value: "text", onChange: "handler", rows: "rows" }],
  [Select, { label: "text", value: "text", options: "options", onChange: "handler" }],
  [Checkbox, { label: "text", checked: "flag", onChange: "handler" }],
  [Dialog, { title: "text", children: "node", onClose: "handler", footer: "node" }],
  [Drawer, { title: "text", children: "node", onClose: "handler", footer: "node", side: ["right", "left"] }],
  [Card, { title: "text", children: "node" }],
  [Badge, { children: "node", tone: ["neutral", "primary", "danger"] }],
  [Field, { label: "text", children: "node" }],
]);
function apiProps(rule: ApiRule, source: Props, depth: number): Props {
  const out: Props = {};
  for (const [name, value] of Object.entries(source)) {
    const kind = Object.prototype.hasOwnProperty.call(rule, name) ? rule[name] : undefined;
    if (kind === undefined) continue;
    if (kind === "node") out[name] = sanitize(value, depth + 1);
    else if (kind === "handler") {
      if (typeof value === "function") out[name] = value;
    } else if (kind === "flag") {
      if (typeof value === "boolean") out[name] = value;
    } else if (kind === "rows") {
      if (typeof value === "number" && Number.isFinite(value)) out[name] = Math.min(Math.max(Math.round(value), 1), 20);
    } else if (kind === "options") {
      if (Array.isArray(value)) {
        const options: string[] = [];
        const count = Math.min(value.length, 200);
        for (let i = 0; i < count; i++) options.push(safeText(String(value[i] ?? "").slice(0, 200)));
        out.options = options;
      }
    } else if (kind === "text") {
      if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) out[name] = safeText(String(value).slice(0, 2000));
    } else if (typeof value === "string" && kind.includes(value)) out[name] = value;
  }
  return out;
}

const keyOf = (value: unknown) => (typeof value === "string" || typeof value === "number" ? value : undefined);
const maxDepth = 64;
const maxChildren = 1000;

/**
 * Ricostruisce l'uscita di un componente su misura con elementi creati qui. `svg` dice se
 * il nodo sta dentro un <svg>: solo lì <title> è il suggerimento del disegno (fuori, React
 * lo porterebbe nel titolo della pagina).
 */
export function sanitize(node: unknown, depth = 0, svg = false): ReactNode {
  if (depth > maxDepth) return null;
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (typeof node === "string") return safeText(node.length > 20000 ? node.slice(0, 20000) : node);
  if (typeof node === "number") return Number.isFinite(node) ? node : null;
  if (typeof node === "bigint") return String(node);
  if (typeof node !== "object") return null;
  if (Array.isArray(node)) {
    const out: ReactNode[] = [];
    const count = Math.min(node.length, maxChildren);
    for (let i = 0; i < count; i++) out.push(sanitize(node[i], depth + 1, svg));
    return out;
  }
  // Ogni campo si legge una volta sola: un getter non può cambiare idea fra controllo e uso.
  const element = node as Props;
  if (!elementTags.has(element.$$typeof)) return null;
  const type = element.type;
  const key = keyOf(element.key);
  const rawProps = element.props;
  const source: Props = rawProps !== null && typeof rawProps === "object" ? (rawProps as Props) : {};
  if (type === Fragment) return createElement(Fragment, { key }, sanitize(source.children, depth + 1, svg));
  if (typeof type === "string") {
    if (!customAllowedTags.has(type) || (type === "title" && !svg)) return null;
    return createElement(type, { ...domProps(source, depth, svg || type === "svg"), key });
  }
  if (typeof type !== "function") return null;
  const rule = apiRules.get(type);
  if (rule) return createElement(type as ComponentType<Props>, { ...apiProps(rule, source, depth), key });
  // Componente locale del file generato: lo chiama l'involucro, la sua uscita passa da qui.
  const props: Props = {};
  for (const [name, value] of Object.entries(source)) if (name !== "key" && name !== "ref") props[name] = value;
  return createElement(guardComponent(type, renderingName), { ...props, key });
}

// --- 3. Involucri -----------------------------------------------------------------

const wrappers = new WeakMap<object, ComponentType<Props>>();
function Unavailable(): ReactNode {
  throw new Error("custom_component_missing");
}
// Nome del componente su misura che si sta disegnando: i componenti locali del suo file
// (resi da sanitize) ne prendono il nome, per i tempi e l'esclusione.
let renderingName: string | undefined;

/** Componente React affidabile che chiama la funzione generata e ricostruisce l'uscita. */
export function guardComponent(component: unknown, name?: string): ComponentType<Props> {
  if (typeof component !== "function") return Unavailable;
  const known = wrappers.get(component);
  if (known) return known;
  const call = component as (props: Props) => unknown;
  // Chiamata semplice: `this` è undefined e React non vede mai la funzione generata. Un
  // rendering che dura troppo (anche per un'unica operazione lunga, senza giri di ciclo)
  // ferma il componente: riquadro di errore, adesso e dopo. Il tempo di ogni rendering
  // conta per il tetto complessivo (sezione 5).
  const Guarded = (props: Props) => {
    if (slowFunctions.has(call) || (name !== undefined && customComponentStopped(name))) throw tooSlow();
    const previous = renderingName;
    renderingName = name;
    const start = clock();
    try {
      const out = withinBudget(() => sanitize(call({ ...props })));
      const spent = clock() - start;
      if (spent > customCallBudget) {
        slowFunctions.add(call);
        if (name !== undefined) stopCustomComponent(name, "un rendering durava troppo");
        throw tooSlow();
      }
      if (name !== undefined) noteBusy(name, spent);
      return out;
    } finally {
      renderingName = previous;
    }
  };
  wrappers.set(component, Guarded);
  return Guarded;
}

// --- 4. Timer ------------------------------------------------------------------------
// Ogni file di src/custom/ riceve i suoi timer da customTimers (intestazione scritta alla
// pubblicazione): il browser chiamerebbe la funzione con `this` uguale alla finestra, qui
// la chiamata è semplice. Solo funzioni, mai testi da eseguire. Per ogni componente al
// massimo customTimerLimit timer attivi e intervalli di almeno customIntervalMin ms; ogni
// chiamata ha il tempo di un rendering e conta per il tetto complessivo. Un componente
// fermato o escluso non ha più timer.
type Timer = ReturnType<typeof globalThis.setTimeout>;
export const customTimerLimit = 5;
export const customIntervalMin = 250;
const componentTimers = new Map<string, Map<Timer, "timeout" | "interval">>();
const delayOf = (ms: unknown) => Math.min(Math.max(Number(ms) || 0, 0), 600000);
const isWatchdog = (error: unknown) => error instanceof Error && error.message === "custom_too_slow";
function clearComponentTimers(name: string) {
  const timers = componentTimers.get(name);
  if (!timers) return;
  for (const [id, kind] of timers) {
    if (kind === "interval") globalThis.clearInterval(id);
    else globalThis.clearTimeout(id);
  }
  timers.clear();
}
// Un componente escluso (finestre, testi, tempi) perde subito tutti i suoi timer.
subscribeCustomStops(() => {
  for (const name of componentTimers.keys()) if (customComponentStopped(name)) clearComponentTimers(name);
});

/** Timer di un file di src/custom/ (l'intestazione li chiede una volta, con il nome). */
export function customTimers(name: string) {
  let timers = componentTimers.get(name);
  if (!timers) componentTimers.set(name, (timers = new Map()));
  const active = timers;
  const start = (fn: unknown, ms: unknown, repeat: boolean): Timer | undefined => {
    if (typeof fn !== "function") throw new TypeError("custom_timer_function");
    const callback = fn as () => unknown;
    if (customComponentStopped(name)) return undefined;
    if (active.size >= customTimerLimit) {
      stopCustomComponent(name, `più di ${customTimerLimit} timer attivi`);
      return undefined;
    }
    const run = () => {
      if (!repeat) active.delete(id);
      if (customComponentStopped(name)) return clearComponentTimers(name);
      const begin = clock();
      try {
        withinBudget(() => void callback());
      } catch (error) {
        // Un intervallo che si ferma per un errore non riparte.
        if (repeat) stop(id);
        if (!isWatchdog(error)) throw error;
      } finally {
        const spent = clock() - begin;
        if (spent > customCallBudget) stopCustomComponent(name, "un timer lavorava troppo a lungo");
        else noteBusy(name, spent);
      }
    };
    const id: Timer = repeat ? globalThis.setInterval(run, Math.max(delayOf(ms), customIntervalMin)) : globalThis.setTimeout(run, delayOf(ms));
    active.set(id, repeat ? "interval" : "timeout");
    return id;
  };
  const stop = (id: Timer | undefined) => {
    if (id === undefined || !active.has(id)) return;
    if (active.get(id) === "interval") globalThis.clearInterval(id);
    else globalThis.clearTimeout(id);
    active.delete(id);
  };
  return {
    setTimeout: (fn: unknown, ms?: unknown) => start(fn, ms, false),
    setInterval: (fn: unknown, ms?: unknown) => start(fn, ms, true),
    clearTimeout: stop,
    clearInterval: stop,
  };
}

// --- 5. Watchdog ---------------------------------------------------------------------
// JavaScript non si interrompe dall'esterno. Alla pubblicazione ogni funzione e ogni giro
// di ciclo dei file di src/custom/ chiama il proprio `__mk()` (instrumentMockupCustomCodeWith
// in shared/mockupCustomCheck.ts), che è il controllo qui sotto: oltre il tempo concesso
// lancia un errore. Il componente si ferma fino al prossimo caricamento della pagina e il
// suo ErrorBoundary mostra il riquadro, anche se il ciclo non finirebbe mai. Tempi:
// customCallBudget per un rendering o un timer, customRunBudget di codice generato di fila
// per il resto (effetti, gestori dei clic) e, in tutto, non più di customBusyShare del tempo
// in ogni finestra di customBusyWindow ms (anche con tante chiamate brevi). Restano fuori
// solo le singole operazioni del browser molto lunghe: il controllo del rendering e dei
// timer le ferma subito dopo.
export const customCallBudget = 200;
export const customRunBudget = 1000;
export const customBusyWindow = 2000;
export const customBusyShare = 0.3;
const performanceClock = globalThis.performance;
const clock = () => performanceClock.now();
// Inizio del codice generato nel compito corrente (-1: nessuno). Si azzera al compito
// successivo con un messaggio, che non rallenta come un timer nelle schede in secondo piano.
let runStart = -1;
let deadline = Infinity;
let wrapped = 0;
// Tempo del codice generato fuori da rendering e timer (effetti, clic) nel compito
// corrente, per componente: da un primo a un ultimo controllo; si somma a fine compito.
const spans = new Map<string, { first: number; last: number }>();
let taskEnd: (() => void) | undefined;
const nextTask = () => {
  if (!taskEnd) {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      runStart = -1;
      const done = [...spans];
      spans.clear();
      for (const [name, span] of done) noteBusy(name, span.last - span.first);
    };
    // In Node (test) la porta non tiene vivo il processo.
    (channel.port1 as unknown as { unref?: () => void }).unref?.();
    taskEnd = () => channel.port2.postMessage(null);
  }
  taskEnd();
};
const slowFunctions = new WeakSet<object>();
function tooSlow() {
  return new Error("custom_too_slow");
}
// Tempo usato da ogni componente negli ultimi customBusyWindow ms.
const busyLog = new Map<string, { at: number; spent: number }[]>();
function noteBusy(name: string, spent: number) {
  if (!(spent > 0) || customComponentStopped(name)) return;
  const now = clock();
  const log = (busyLog.get(name) ?? []).filter((entry) => now - entry.at < customBusyWindow);
  log.push({ at: now, spent });
  busyLog.set(name, log);
  if (log.reduce((total, entry) => total + entry.spent, 0) > customBusyWindow * customBusyShare)
    stopCustomComponent(name, `usava più del ${Math.round(customBusyShare * 100)}% del tempo della pagina`);
}

/** Esegue `run` con al massimo customCallBudget ms di codice generato. */
function withinBudget<T>(run: () => T): T {
  const previous = deadline;
  deadline = Math.min(previous, clock() + customCallBudget);
  wrapped++;
  try {
    return run();
  } finally {
    wrapped--;
    deadline = previous;
  }
}

/**
 * Watchdog di un file di src/custom/ (l'intestazione lo chiama una volta, con il nome). Un
 * componente escluso per qualunque motivo (anche dalle sue finestre o dai suoi testi) non
 * esegue più nulla: ogni sua funzione lancia subito l'errore.
 */
export function customTicker(name: string): () => void {
  let stopped = false;
  return () => {
    if (stopped || customComponentStopped(name)) throw tooSlow();
    const now = clock();
    if (runStart < 0) {
      runStart = now;
      nextTask();
    }
    if (!wrapped) {
      const span = spans.get(name);
      if (span) span.last = now;
      else spans.set(name, { first: now, last: now });
    }
    if (now > deadline || now - runStart > customRunBudget) {
      stopped = true;
      stopCustomComponent(name, "lavorava troppo a lungo e bloccava la pagina");
      throw tooSlow();
    }
  };
}

/**
 * Caricatore di un modulo di src/custom/: congela prima, poi restituisce l'involucro.
 * Se il congelamento non riesce (adesso o in una chiamata precedente) il modulo non si
 * carica affatto: ogni componente resta nel suo ErrorBoundary.
 */
export function guardCustomModule(name: string, load: () => Promise<{ default?: unknown }>): Promise<{ default: ComponentType<Props> }> {
  try {
    hardenIntrinsics();
  } catch {
    return Promise.reject(new Error("custom_guard_unavailable"));
  }
  return load().then((module) => ({ default: guardComponent(module.default, name) }));
}
