/**
 * A byte-exact HTML tokenizer.
 *
 * DOMParser is not usable here: it gives us a tree but no source offsets, and
 * we must be able to patch the *original* string in place. Every edit this app
 * makes is a splice into an offset range produced below, so the offsets have to
 * be exact and stable.
 *
 * This walks the raw template string once and records, for every element, the
 * span of its open tag and of each attribute value; and for every text run, the
 * span of the run itself.
 */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is not parsed as markup. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

/** Text inside these never counts as editable page copy. */
const NON_COPY_ELEMENTS = new Set(['script', 'style']);

export interface Span {
  start: number;
  end: number;
}

export interface AttrNode extends Span {
  name: string;
  /** Span of the value only, excluding surrounding quotes. */
  valueStart: number;
  valueEnd: number;
  value: string;
  quote: '"' | "'" | '';
}

export interface ElementNode {
  id: string;
  tag: string;
  /** Span of the entire open tag, `<h1 ...>` inclusive. */
  openStart: number;
  openEnd: number;
  /** Insertion point for a new attribute: just before `>` or `/>`. */
  attrInsertAt: number;
  attrs: AttrNode[];
  parentId: string | null;
  depth: number;
  /** Sibling index among same-tag siblings, for a readable path. */
  path: string;
  /**
   * For raw-text elements (<style>, <script>), the span of their content.
   * The Theme panel needs it to locate custom properties inside <style>.
   */
  rawTextStart?: number;
  rawTextEnd?: number;
  /**
   * End of the element's closing tag, so `[openStart, closeEnd)` is its whole
   * source. Absent when the element never closes — a void element, or markup
   * that simply does not close it — in which case the open tag is the extent.
   */
  closeEnd?: number;
}

export type StringKind = 'text' | 'attr';

export interface StringEntry {
  id: string;
  kind: StringKind;
  /** Owning element. For `attr`, the element carrying the attribute. */
  elementId: string;
  /**
   * For `text`, which text run of that element this is. The preview bridge
   * needs it to update the right node when an element holds several runs.
   */
  runOrdinal?: number;
  /** Tag shown in the UI: `h1`, `p`, `og:title`, `img@alt`. */
  tag: string;
  label: string;
  /** Span of the editable value within the template string. */
  start: number;
  end: number;
  /** The raw source slice — still entity-encoded. */
  raw: string;
  /** Decoded, human-facing text. This is what the editor shows. */
  value: string;
  attrName?: string;
  /**
   * True when the value is a runtime template placeholder such as
   * `{{ availabilityText }}`. Editing it would be pointless — the page
   * overwrites it on render — so the UI shows it read-only and says why.
   */
  computed: boolean;
  /**
   * True when this string is page *information* rather than page content —
   * it lives in the head and is never drawn. Search results and link previews
   * read it; a visitor looking at the page never sees it.
   *
   * Decided by the owning element, not by a label, because the labels are
   * written for people and `<link href>` reads as "Description" in the UI
   * while being pure head furniture.
   */
  pageInfo: boolean;
}

const PLACEHOLDER = /\{\{[^}]*\}\}/;

/** Elements whose strings never appear on the page. */
const HEAD_ONLY = new Set(['meta', 'link', 'title', 'base']);

export interface TemplateIndex {
  elements: ElementNode[];
  byId: Map<string, ElementNode>;
  strings: StringEntry[];
  stringsById: Map<string, StringEntry>;
}

const NAME_START = /[A-Za-z]/;
const ATTR_NAME_END = /[\s/>=]/;

/** Attributes whose value is user-facing copy worth indexing. */
/**
 * What to call this value in the panel.
 *
 * Everything that was not a meta tag used to be called "Description", so a
 * link's web address appeared under the same heading as the text describing a
 * photograph. The name a person reads has to say which of those they are
 * looking at, or they edit the wrong one.
 */
function attrLabel(tag: string, name: string): string {
  if (tag === 'meta') return 'Share / SEO';
  if (name === 'alt') return 'Description';
  if (name === 'title') return 'Tooltip';
  if (name === 'href') return 'Link address';
  return 'Description';
}

function copyAttrLabel(tag: string, attrs: AttrNode[], name: string): string | null {
  if (tag === 'meta') {
    const key = attrs.find((a) => a.name === 'property' || a.name === 'name');
    if (name === 'content' && key) return key.value;
    return null;
  }
  if (name === 'alt') return `${tag}@alt`;
  if (name === 'title') return `${tag}@title`;
  if (tag === 'a' && name === 'href') return 'link@href';
  return null;
}

export interface TextRun {
  start: number;
  end: number;
  /** The element this run sits directly inside. */
  ownerId: string | null;
  /** Which text run this is among that element's direct children. */
  ordinal: number;
}

export interface TokenizeResult {
  elements: ElementNode[];
  runs: TextRun[];
}

export function tokenize(src: string): TokenizeResult {
  const out: ElementNode[] = [];
  const runs: TextRun[] = [];
  const stack: ElementNode[] = [];
  const childCounts = new Map<string, number>();
  const runCounts = new Map<string, number>();
  let i = 0;
  let n = 0;

  /**
   * Record the text between the previous tag and this one. Called at every
   * tag boundary, so text that follows a nested child -- the `ing` in
   * `<p>Do <b>the</b> ing</p>` -- is captured, not just the run that opens
   * an element.
   */
  const flushText = (from: number, to: number) => {
    if (to <= from) return;
    const owner = stack[stack.length - 1] ?? null;
    if (owner && NON_COPY_ELEMENTS.has(owner.tag)) return;
    if (!src.slice(from, to).trim()) return;
    const key = owner ? owner.id : '#root';
    const ordinal = runCounts.get(key) ?? 0;
    runCounts.set(key, ordinal + 1);
    runs.push({ start: from, end: to, ownerId: owner ? owner.id : null, ordinal });
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      flushText(i, src.length);
      break;
    }
    flushText(i, lt);

    // Comment / doctype / CDATA — skip wholesale.
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    // Close tag.
    if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt);
      if (end === -1) break;
      const name = src.slice(lt + 2, end).trim().toLowerCase();
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].tag === name) {
          // Everything above it on the stack was left unclosed; give each the
          // same end so no element claims source beyond its parent.
          for (let k = stack.length - 1; k >= s; k--) stack[k].closeEnd = end + 1;
          stack.length = s;
          break;
        }
      }
      i = end + 1;
      continue;
    }

    if (!NAME_START.test(src[lt + 1] ?? '')) {
      i = lt + 1;
      continue;
    }

    // Open tag: read the name.
    let p = lt + 1;
    while (p < src.length && !ATTR_NAME_END.test(src[p])) p++;
    const tag = src.slice(lt + 1, p).toLowerCase();

    // Attributes.
    const attrs: AttrNode[] = [];
    let selfClosing = false;
    while (p < src.length) {
      while (p < src.length && /\s/.test(src[p])) p++;
      if (p >= src.length) break;
      if (src[p] === '>') break;
      if (src[p] === '/' && src[p + 1] === '>') {
        selfClosing = true;
        break;
      }
      const nameStart = p;
      while (p < src.length && !ATTR_NAME_END.test(src[p])) p++;
      const name = src.slice(nameStart, p).toLowerCase();
      if (!name) {
        p++;
        continue;
      }
      let valueStart = p;
      let valueEnd = p;
      let value = '';
      let quote: '"' | "'" | '' = '';
      let scan = p;
      while (scan < src.length && /\s/.test(src[scan])) scan++;
      if (src[scan] === '=') {
        scan++;
        while (scan < src.length && /\s/.test(src[scan])) scan++;
        const q = src[scan];
        if (q === '"' || q === "'") {
          quote = q;
          valueStart = scan + 1;
          const close = src.indexOf(q, valueStart);
          valueEnd = close === -1 ? src.length : close;
          value = src.slice(valueStart, valueEnd);
          p = valueEnd + 1;
        } else {
          valueStart = scan;
          while (scan < src.length && !/[\s>]/.test(src[scan])) scan++;
          valueEnd = scan;
          value = src.slice(valueStart, valueEnd);
          p = valueEnd;
        }
      }
      attrs.push({ name, start: nameStart, end: p, valueStart, valueEnd, value, quote });
    }

    const gt = src.indexOf('>', p);
    if (gt === -1) break;
    const openEnd = gt + 1;
    const attrInsertAt = src[gt - 1] === '/' ? gt - 1 : gt;

    const parent = stack[stack.length - 1] ?? null;
    const parentKey = parent ? parent.id : '#root';
    const countKey = `${parentKey}/${tag}`;
    const idx = (childCounts.get(countKey) ?? 0) + 1;
    childCounts.set(countKey, idx);

    const node: ElementNode = {
      id: `e${n++}`,
      tag,
      openStart: lt,
      openEnd,
      attrInsertAt,
      attrs,
      parentId: parent ? parent.id : null,
      depth: stack.length,
      path: `${parent ? parent.path : ''}/${tag}[${idx}]`,
    };
    out.push(node);

    // Raw-text elements swallow everything up to their close tag.
    if (RAW_TEXT_ELEMENTS.has(tag) && !selfClosing) {
      const close = src.toLowerCase().indexOf(`</${tag}`, openEnd);
      node.rawTextStart = openEnd;
      node.rawTextEnd = close === -1 ? src.length : close;
      i = node.rawTextEnd;
      continue;
    }

    if (!selfClosing && !VOID_ELEMENTS.has(tag)) stack.push(node);
    i = openEnd;
  }

  return { elements: out, runs };
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITY_MAP[body.toLowerCase()] ?? whole;
  });
}

export function encodeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function encodeAttr(s: string, quote: '"' | "'" | '' = '"'): string {
  let out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (quote === '"') out = out.replace(/"/g, '&quot;');
  if (quote === "'") out = out.replace(/'/g, '&#39;');
  return out;
}

/** Human label for a copy string, derived from the element that carries it. */
function textLabel(tag: string): string {
  switch (tag) {
    case 'h1': return 'Main heading';
    case 'h2': return 'Section heading';
    case 'h3': return 'Subheading';
    case 'h4': case 'h5': case 'h6': return 'Minor heading';
    case 'p': return 'Paragraph';
    case 'a': return 'Link';
    case 'button': return 'Button';
    case 'li': return 'List item';
    case 'span': return 'Text';
    case 'title': return 'Page title';
    default: return 'Text';
  }
}

/**
 * Build the string index.
 *
 * A text run counts as editable copy when it is non-blank and its nearest
 * enclosing element is not <script> or <style>. Attribute copy (meta content,
 * alt text) is indexed alongside it so the Words panel can show everything on
 * the page in one list.
 */
export function indexTemplate(src: string): TemplateIndex {
  const { elements, runs } = tokenize(src);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const strings: StringEntry[] = [];
  let sid = 0;

  for (const run of runs) {
    const owner = run.ownerId ? byId.get(run.ownerId) : undefined;
    const raw = src.slice(run.start, run.end);

    // Keep the surrounding whitespace outside the editable span so an edit
    // never destroys the file's indentation.
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const start = run.start + lead;
    const end = run.end - trail;
    const text = src.slice(start, end);

    strings.push({
      id: `s${sid++}`,
      kind: 'text',
      elementId: owner ? owner.id : '',
      runOrdinal: run.ordinal,
      tag: owner ? owner.tag : 'text',
      label: textLabel(owner ? owner.tag : 'text'),
      start,
      end,
      raw: text,
      value: decodeEntities(text),
      computed: PLACEHOLDER.test(text),
      pageInfo: HEAD_ONLY.has(owner ? owner.tag : ''),
    });
  }

  // Attribute copy.
  for (const el of elements) {
    for (const attr of el.attrs) {
      const label = copyAttrLabel(el.tag, el.attrs, attr.name);
      if (!label) continue;
      if (!attr.value.trim()) continue;
      strings.push({
        id: `s${sid++}`,
        kind: 'attr',
        elementId: el.id,
        tag: label,
        label: attrLabel(el.tag, attr.name),
        attrName: attr.name,
        start: attr.valueStart,
        end: attr.valueEnd,
        raw: attr.value,
        value: decodeEntities(attr.value),
        computed: PLACEHOLDER.test(attr.value),
        pageInfo: HEAD_ONLY.has(el.tag),
      });
    }
  }

  strings.sort((a, b) => a.start - b.start);
  return { elements, byId, strings, stringsById: new Map(strings.map((s) => [s.id, s])) };
}

/**
 * The element's entire source, open tag through closing tag.
 *
 * This is the range the code editor replaces, so it must never extend past the
 * element — a wrong end here would silently eat a sibling.
 */
export function outerRange(el: ElementNode): { start: number; end: number } {
  return { start: el.openStart, end: el.closeEnd ?? el.openEnd };
}

export interface Edit {
  start: number;
  end: number;
  /** Already-encoded replacement text. */
  replacement: string;
}

/**
 * Apply edits to the source string.
 *
 * Applied back-to-front so earlier offsets stay valid. Overlapping edits are a
 * programming error and throw rather than silently corrupting the file.
 */
export function applyEdits(src: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].end > sorted[i - 1].start) {
      throw new Error(
        `Overlapping edits: [${sorted[i].start},${sorted[i].end}) and ` +
        `[${sorted[i - 1].start},${sorted[i - 1].end})`,
      );
    }
  }
  let out = src;
  for (const e of sorted) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
}

/**
 * Stamp `data-recto-id` onto every element.
 *
 * Used only for the preview iframe — the published file never carries these.
 * Verified against the real bundle: the Claude Design runtime passes unknown
 * attributes straight through to the rendered DOM, which is what makes
 * click-to-select possible at all.
 */
export function tagForPreview(src: string, index: TemplateIndex): string {
  // Only the id. There is deliberately no attempt to stash the asset reference
  // alongside it: measured against the live bundle, the runtime resolves an
  // asset id in *any* attribute, not just `src`, so a copy of it is rewritten
  // to a blob URL exactly like the original. The mapping is supplied by the
  // editor instead, which still holds the source.
  const edits: Edit[] = index.elements.map((el) => ({
    start: el.attrInsertAt,
    end: el.attrInsertAt,
    replacement: ` data-recto-id="${el.id}"`,
  }));
  return applyEdits(src, edits);
}
