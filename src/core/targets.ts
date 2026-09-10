/**
 * Everything the editor can change, addressed uniformly.
 *
 * Words, inline style declarations, and theme tokens are all "a byte range in
 * the decoded template plus a rule for encoding the replacement". Collapsing
 * them into one type means the queue, the patch store, and the publish pipeline
 * each handle one kind of thing rather than three.
 */

import { encodeAttr, encodeText, tokenize, type TemplateIndex } from './htmlIndex';
import { elementHoverStyle, elementStyle, findRules, findThemeTokens, type CssRule, type StyleDecl, type ThemeToken } from './css';

export type TargetKind = 'text' | 'attr' | 'css-inline' | 'css-hover' | 'css-theme' | 'css-rule' | 'html';

export interface EditTarget {
  id: string;
  kind: TargetKind;
  start: number;
  end: number;
  /** Shown in the queue and the publish review. */
  label: string;
  /** `h1`, `og:title`, `color`, `--gold`. */
  tag: string;
  /** The value as it stands in the working copy. */
  current: string;
  /** Owning element, where there is one. */
  elementId?: string;
  /** For text targets, which run of the element. */
  runOrdinal?: number;
  attrName?: string;
  /** For css targets, the property being set. */
  prop?: string;
}

export interface TargetSet {
  byId: Map<string, EditTarget>;
  tokens: ThemeToken[];
  /** Every style rule in the page's <style> blocks. */
  rules: CssRule[];
  declsByElement: Map<string, StyleDecl[]>;
  /** Declarations the runtime applies on pointer enter. */
  hoverByElement: Map<string, StyleDecl[]>;
}

/**
 * Encode a replacement for the context it is being written into.
 *
 * Getting this wrong is how you corrupt a file quietly, so it lives in one
 * place with the reasoning attached rather than at each call site.
 */
export function encodeFor(kind: TargetKind, value: string): string {
  switch (kind) {
    case 'text':
      return encodeText(value);
    case 'attr':
      return encodeAttr(value);
    case 'css-inline':
    case 'css-hover':
      // Sits inside style="…" or style-hover="…", so it is an attribute value
      // first and CSS second. A stray quote would end the attribute.
      return encodeAttr(value);
    case 'css-rule':
    case 'css-theme':
      // Sits in <style> raw text, where entities are NOT decoded — writing
      // &amp; here would put a literal ampersand-a-m-p in the stylesheet. The
      // only sequence that matters is one that could close the element.
      return value.replace(/<\//g, '<\\/');
    case 'html':
      // Already markup. Entity-encoding it would turn the user's tags into
      // visible text. The bundle codec escapes it for the script block;
      // structural safety is validateFragment's job, not this function's.
      return value;
  }
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Check that a hand-edited fragment closes everything it opens.
 *
 * This is the guard that makes offering code editing defensible at all. An
 * unclosed tag does not fail loudly — it silently swallows the rest of the
 * page, because every following sibling becomes its child. Refusing costs a
 * sentence; not refusing costs the layout of the whole site.
 */
export function validateFragment(fragment: string): string | null {
  if (!fragment.trim()) {
    return 'The code cannot be empty. Undo the change rather than clearing it.';
  }

  const opens: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) {
    const name = m[2].toLowerCase();
    if (VOID.has(name) || m[3].trimEnd().endsWith('/')) continue;
    if (m[1]) {
      const at = opens.lastIndexOf(name);
      if (at === -1) return `There is a closing </${name}> with nothing to close.`;
      if (at !== opens.length - 1) {
        // `<div><p>text</div>` — closing an ancestor while a child is still
        // open. A browser silently recovers from this, which is exactly why it
        // has to be reported: the page looks fine and the structure is wrong.
        const unclosed = opens[opens.length - 1];
        return `<${unclosed}> is never closed, but </${name}> closes around it.`;
      }
      opens.length = at;
    } else {
      opens.push(name);
    }
  }
  if (opens.length) {
    const one = opens[opens.length - 1];
    return `<${one}> is never closed. An unclosed tag swallows the rest of the page.`;
  }

  // It must still be markup, or we would be silently replacing an element with
  // plain text.
  if (!tokenize(fragment).elements.length) {
    return 'That is not markup any more — there are no tags left in it.';
  }
  return null;
}

/** Reject values that cannot be written safely, before anything is patched. */
export function validate(kind: TargetKind, value: string): string | null {
  if (kind === 'html') return validateFragment(value);
  if (kind === 'css-theme' || kind === 'css-rule' || kind === 'css-inline' || kind === 'css-hover') {
    if (value.includes(';') && (kind === 'css-inline' || kind === 'css-hover')) {
      return 'A single value cannot contain a semicolon — that would add another property.';
    }
    if (value.includes('}') || value.includes('{')) {
      return 'Braces are not allowed in a style value.';
    }
    if (!value.trim()) return 'A style value cannot be empty.';
  }
  return null;
}

export function buildTargets(template: string, index: TemplateIndex): TargetSet {
  const byId = new Map<string, EditTarget>();

  for (const s of index.strings) {
    byId.set(s.id, {
      id: s.id,
      kind: s.kind === 'attr' ? 'attr' : 'text',
      start: s.start,
      end: s.end,
      label: s.label,
      tag: s.tag,
      current: s.value,
      elementId: s.elementId,
      runOrdinal: s.runOrdinal,
      attrName: s.attrName,
    });
  }

  const declsByElement = new Map<string, StyleDecl[]>();
  const hoverByElement = new Map<string, StyleDecl[]>();
  for (const el of index.elements) {
    for (const [decls, kind, store] of [
      [elementStyle(el), 'css-inline' as const, declsByElement],
      [elementHoverStyle(el), 'css-hover' as const, hoverByElement],
    ] as const) {
      if (!decls.length) continue;
      store.set(el.id, decls);
      for (const d of decls) {
        byId.set(d.id, {
          id: d.id,
          kind,
          start: d.valueStart,
          end: d.valueEnd,
          label: kind === 'css-hover' ? `${el.tag} · ${d.prop} on hover` : `${el.tag} · ${d.prop}`,
          tag: d.prop,
          current: d.value,
          elementId: el.id,
          prop: d.prop,
        });
      }
    }
  }

  const rules = findRules(template, index);
  for (const r of rules) {
    for (const d of r.decls) {
      const id = `${r.id}:${d.prop}`;
      byId.set(id, {
        id,
        kind: 'css-rule',
        start: d.valueStart,
        end: d.valueEnd,
        label: `${r.selector} · ${d.prop}`,
        tag: d.prop,
        current: d.value,
        prop: d.prop,
      });
    }
  }

  const tokens = findThemeTokens(template, index);
  for (const t of tokens) {
    byId.set(t.id, {
      id: t.id,
      kind: 'css-theme',
      start: t.valueStart,
      end: t.valueEnd,
      label: `Theme · ${t.prop}`,
      tag: t.prop,
      current: t.value,
      prop: t.prop,
    });
  }

  return { byId, tokens, rules, declsByElement, hoverByElement };
}
