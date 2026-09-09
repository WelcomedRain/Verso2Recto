/**
 * CSS reading, with byte-exact ranges.
 *
 * Two things get parsed here, and they answer the two halves of the user's
 * stated priority — "theme values AND per-element override":
 *
 *   - custom properties inside `:root { … }`, which one edit changes everywhere
 *   - declarations inside an element's `style="…"` attribute, which change one
 *     element and nothing else
 *
 * Both come back as ranges into the decoded template so the existing patch
 * machinery applies unchanged.
 *
 * The design brief assumed the site had no shared tokens and that theme editing
 * would need a one-time source change or a 34-place find-and-replace. That is
 * not true of the current export: it carries real `:root` blocks and the markup
 * references them as `var(--ink)`. Theme editing is therefore an ordinary patch.
 */

import type { ElementNode, TemplateIndex } from './htmlIndex';

export interface Declaration {
  /** `color`, `--gold`, `font-size`. */
  prop: string;
  value: string;
  /** Span of the value only, so a patch never disturbs the property name. */
  valueStart: number;
  valueEnd: number;
  /** Span of the whole `prop: value` pair, used when removing a declaration. */
  start: number;
  end: number;
}

/**
 * Split a declaration list into `prop: value` pairs.
 *
 * Hand-written rather than regex-per-declaration because values legitimately
 * contain the delimiters: `clamp(34px, 5.2vw, 68px)` has commas, `url(data:…)`
 * has colons, and `"Archivo", sans-serif` has quoted commas. Tracking paren and
 * quote depth is the only way to split on the right semicolons.
 */
export function parseDeclarations(text: string, base = 0): Declaration[] {
  const out: Declaration[] = [];
  let depth = 0;
  let quote: string | null = null;
  let segStart = 0;

  const flush = (from: number, to: number) => {
    const raw = text.slice(from, to);
    if (!raw.trim()) return;
    // The first colon at depth zero separates property from value.
    let d = 0;
    let q: string | null = null;
    let colon = -1;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) { if (c === q && raw[i - 1] !== '\\') q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '(') d++;
      else if (c === ')') d--;
      else if (c === ':' && d === 0) { colon = i; break; }
    }
    if (colon === -1) return;

    const prop = raw.slice(0, colon).trim();
    if (!prop) return;

    const valueRaw = raw.slice(colon + 1);
    const lead = valueRaw.length - valueRaw.trimStart().length;
    const trail = valueRaw.length - valueRaw.trimEnd().length;
    const valueStart = from + colon + 1 + lead;
    const valueEnd = from + raw.length - trail;
    if (valueEnd <= valueStart) return;

    const propLead = raw.length - raw.trimStart().length;
    out.push({
      prop,
      value: text.slice(valueStart, valueEnd),
      valueStart: base + valueStart,
      valueEnd: base + valueEnd,
      start: base + from + propLead,
      end: base + valueEnd,
    });
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) {
      flush(segStart, i);
      segStart = i + 1;
    }
  }
  flush(segStart, text.length);
  return out;
}

export interface ThemeToken extends Declaration {
  id: string;
  /** Which <style> block it came from, for grouping in the UI. */
  blockIndex: number;
  /** True for the site's own tokens rather than the design system's ramps. */
  primary: boolean;
  kind: 'color' | 'font' | 'length' | 'other';
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgb|rgba|hsl|hsla|color-mix|oklch)/i;
const LENGTH_RE = /^-?[\d.]+(px|rem|em|%|vw|vh|ch)$/i;

function kindOf(value: string): ThemeToken['kind'] {
  if (COLOR_RE.test(value.trim())) return 'color';
  if (LENGTH_RE.test(value.trim())) return 'length';
  if (/serif|sans-serif|monospace|["']/.test(value)) return 'font';
  return 'other';
}

/** Find every `:root { … }` rule and return the custom properties inside it. */
export function findThemeTokens(template: string, index: TemplateIndex): ThemeToken[] {
  const styles = index.elements.filter(
    (e) => e.tag === 'style' && e.rawTextStart != null && e.rawTextEnd != null,
  );

  const out: ThemeToken[] = [];
  let n = 0;

  styles.forEach((block, blockIndex) => {
    const css = template.slice(block.rawTextStart!, block.rawTextEnd!);
    const base = block.rawTextStart!;

    // `:root` may appear more than once in a block.
    const re = /:root\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      const bodyStart = m.index + m[0].length;
      // Find the matching close brace.
      let depth = 1;
      let i = bodyStart;
      for (; i < css.length && depth > 0; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
      }
      const bodyEnd = i - 1;
      if (bodyEnd <= bodyStart) continue;

      // Comments would otherwise be parsed as declarations.
      const body = css.slice(bodyStart, bodyEnd);
      const stripped = body.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));

      for (const d of parseDeclarations(stripped, base + bodyStart)) {
        if (!d.prop.startsWith('--')) continue;
        out.push({
          ...d,
          id: `t${n++}`,
          blockIndex,
          // The site's own theme block is the last one and is short; the
          // Modernist ramps come from the design system and are rarely retuned.
          primary: blockIndex === styles.length - 1,
          kind: kindOf(d.value),
        });
      }
      re.lastIndex = bodyEnd;
    }
  });

  return out;
}

export interface StyleDecl extends Declaration {
  id: string;
  elementId: string;
}

/** Declarations from one element's `style` attribute. */
export function elementStyle(el: ElementNode): StyleDecl[] {
  const attr = el.attrs.find((a) => a.name === 'style');
  if (!attr || !attr.value.trim()) return [];
  return parseDeclarations(attr.value, attr.valueStart).map((d, i) => ({
    ...d,
    id: `d:${el.id}:${i}`,
    elementId: el.id,
  }));
}

/** Does this element have a `style` attribute at all? */
export function hasStyleAttr(el: ElementNode): boolean {
  return el.attrs.some((a) => a.name === 'style');
}

/**
 * The declarations worth surfacing as controls, in a stable order.
 *
 * Everything else stays visible in the raw list — the point is to put the six
 * or so properties someone actually reaches for at the top, not to hide the
 * rest.
 */
export const FEATURED_PROPS = [
  'color',
  'background',
  'background-color',
  'font-size',
  'font-weight',
  'padding',
  'margin',
  'border',
  'border-radius',
  'letter-spacing',
  'line-height',
  'text-align',
] as const;

export function isColorValue(v: string): boolean {
  const t = v.trim();
  return COLOR_RE.test(t) || /^var\(--[\w-]+\)$/.test(t);
}

/**
 * Resolve `var(--x)` one level against the theme so a swatch can show a real
 * colour. Deliberately not a full cascade resolver — it answers "what colour is
 * this token", which is what the swatch needs.
 */
export function resolveVar(value: string, tokens: ThemeToken[]): string | null {
  const m = value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)$/);
  if (!m) return isColorValue(value) ? value.trim() : null;
  const hit = tokens.find((t) => t.prop === m[1]);
  if (hit) return isColorValue(hit.value) ? hit.value.trim() : null;
  return m[2]?.trim() ?? null;
}
