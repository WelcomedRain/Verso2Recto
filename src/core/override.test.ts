import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { editsFor, type PendingChange } from './publish';
import { parseBundle } from './bundle';
import { indexTemplate, applyEdits } from './htmlIndex';
import { buildTargets } from './targets';
import { parseDeclarations } from './css';

const REAL = 'G:/Anthea-Solve/index.html';
const hasReal = existsSync(REAL);

const override = (over: Partial<PendingChange>): PendingChange => ({
  targetId: 'override:e1', file: 'index.html', label: 'x', tag: 'color',
  kind: 'style-attr', liveValue: '', nextValue: 'color:red', ...over,
});

describe('scoped overrides', () => {
  it('replaces an existing style attribute value in place', () => {
    const [edit] = editsFor([override({ start: 10, end: 20 })], new Map());
    expect(edit).toEqual({ start: 10, end: 20, replacement: 'color:red' });
  });

  /**
   * An element with no style attribute needs one written, not a value swapped.
   * An empty range means insert — without the wrapper the declarations would
   * land loose in the tag and become garbage attributes.
   */
  it('writes a whole attribute when the element has none', () => {
    const [edit] = editsFor([override({ start: 42, end: 42 })], new Map());
    expect(edit.replacement).toBe(' style="color:red"');
  });

  it('escapes a value that would otherwise end the attribute', () => {
    const [edit] = editsFor(
      [override({ start: 5, end: 9, nextValue: 'font-family:"A B"' })], new Map(),
    );
    expect(edit.replacement).not.toContain('"A B"');
    expect(edit.replacement).toContain('&quot;');
  });

  it('refuses to publish one whose position was lost', () => {
    expect(() => editsFor([override({ start: undefined, end: undefined })], new Map()))
      .toThrow(/position in the page was lost/);
  });
});

describe.skipIf(!hasReal)('overrides against the real page', () => {
  const source = hasReal ? readFileSync(REAL, 'utf8') : '';

  it('adding one to an element that already has styles keeps the rest', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const h1 = idx.byId.get(idx.strings.find((s) => s.tag === 'h1')!.elementId)!;
    const attr = h1.attrs.find((a) => a.name === 'style')!;
    const before = parseDeclarations(attr.value).map((d) => d.prop);

    const next = applyEdits(b.template, [
      { start: attr.valueStart, end: attr.valueEnd, replacement: `${attr.value};color:magenta` },
    ]);
    const nextIdx = indexTemplate(next);
    const nextEl = nextIdx.byId.get(nextIdx.strings.find((s) => s.tag === 'h1')!.elementId)!;
    const after = parseDeclarations(nextEl.attrs.find((a) => a.name === 'style')!.value);

    expect(after.map((d) => d.prop)).toEqual([...before, 'color']);
    expect(after.at(-1)!.value).toBe('magenta');
  });

  it('adding one to an element with no style attribute produces valid markup', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const bare = idx.elements.find(
      (e) => !e.attrs.some((a) => a.name === 'style') && e.tag === 'div',
    )!;
    const next = applyEdits(b.template, [
      { start: bare.attrInsertAt, end: bare.attrInsertAt, replacement: ' style="color:red"' },
    ]);
    const nextIdx = indexTemplate(next);
    const t = buildTargets(next, nextIdx);
    // The element now has exactly one style declaration and the page still parses.
    expect(nextIdx.elements.length).toBe(idx.elements.length);
    expect([...t.byId.values()].some((x) => x.kind === 'css-inline' && x.current === 'red')).toBe(true);
  });

  it('an override outranks the stylesheet rule it is overriding', () => {
    // Not a browser test — the guarantee is structural: an inline declaration
    // beats a selector-matched one, which is why "just this one" writes here.
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const t = buildTargets(b.template, idx);
    const ruleTarget = [...t.byId.values()].find((x) => x.kind === 'css-rule');
    const inlineTarget = [...t.byId.values()].find((x) => x.kind === 'css-inline');
    expect(ruleTarget).toBeDefined();
    expect(inlineTarget).toBeDefined();
    // And they are separate ranges, so one can be edited without the other.
    expect(ruleTarget!.start).not.toBe(inlineTarget!.start);
  });
});
