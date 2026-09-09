import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { buildTargets, encodeFor, validate } from './targets';
import { parseBundle, serializeBundle, verifyRoundTrip } from './bundle';
import { indexTemplate, applyEdits } from './htmlIndex';

const REAL = 'G:/Anthea-Solve/index.html';
const hasReal = existsSync(REAL);

describe('encodeFor', () => {
  it('entity-encodes page text', () => {
    expect(encodeFor('text', 'Tom & Jerry <3')).toBe('Tom &amp; Jerry &lt;3');
  });

  it('escapes quotes in an attribute', () => {
    expect(encodeFor('attr', 'He said "hi" & left')).toBe('He said &quot;hi&quot; &amp; left');
  });

  it('escapes an inline style value as an attribute', () => {
    expect(encodeFor('css-inline', 'url("a.png")')).toContain('&quot;');
  });

  it('does NOT entity-encode a theme value — <style> is raw text', () => {
    // Writing &amp; into a stylesheet produces a literal "&amp;", not "&".
    expect(encodeFor('css-theme', 'color-mix(in srgb, #201e1d 40%, transparent)'))
      .toBe('color-mix(in srgb, #201e1d 40%, transparent)');
  });

  it('neutralises a sequence that could close the style element', () => {
    expect(encodeFor('css-theme', 'a</style>b')).not.toContain('</style>');
  });
});

describe('validate', () => {
  it('rejects a semicolon in an inline style value', () => {
    expect(validate('css-inline', 'red;color:blue')).toMatch(/semicolon/);
  });
  it('rejects braces', () => {
    expect(validate('css-theme', '#fff}')).toMatch(/Braces/);
  });
  it('rejects an empty style value', () => {
    expect(validate('css-inline', '   ')).toMatch(/empty/);
  });
  it('allows ordinary values', () => {
    expect(validate('css-inline', 'clamp(34px,5.2vw,68px)')).toBe(null);
    expect(validate('css-theme', '#f2a81c')).toBe(null);
  });
  it('does not constrain page text', () => {
    expect(validate('text', 'anything; goes {here}')).toBe(null);
  });
});

describe.skipIf(!hasReal)('targets over the real site', () => {
  const source = hasReal ? readFileSync(REAL, 'utf8') : '';

  it('covers words, inline styles and theme tokens', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const t = buildTargets(b.template, idx);
    const kinds = new Set([...t.byId.values()].map((x) => x.kind));
    expect(kinds).toContain('text');
    expect(kinds).toContain('attr');
    expect(kinds).toContain('css-inline');
    expect(kinds).toContain('css-theme');
    expect(t.byId.size).toBeGreaterThan(700);
  });

  it('every target range slices back to its current value', () => {
    const b = parseBundle(source);
    const t = buildTargets(b.template, indexTemplate(b.template));
    for (const x of t.byId.values()) {
      const slice = b.template.slice(x.start, x.end);
      // Text targets hold the decoded value; the rest are literal.
      if (x.kind === 'text' || x.kind === 'attr') continue;
      expect(slice).toBe(x.current);
    }
  });

  it('no two targets overlap, so edits can never collide', () => {
    const b = parseBundle(source);
    const t = buildTargets(b.template, indexTemplate(b.template));
    const all = [...t.byId.values()].sort((a, x) => a.start - x.start);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].start).toBeGreaterThanOrEqual(all[i - 1].end);
    }
  });

  it('a text, a style and a theme edit apply together and still round-trip', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const t = buildTargets(b.template, idx);

    const h1 = idx.strings.find((s) => s.tag === 'h1')!;
    const fontSize = [...t.byId.values()].find(
      (x) => x.kind === 'css-inline' && x.elementId === h1.elementId && x.prop === 'font-size',
    )!;
    const gold = [...t.byId.values()].find((x) => x.kind === 'css-theme' && x.prop === '--gold')!;

    const next = applyEdits(b.template, [
      { start: h1.start, end: h1.end, replacement: encodeFor('text', 'Fresh & bold') },
      { start: fontSize.start, end: fontSize.end, replacement: encodeFor('css-inline', '40px') },
      { start: gold.start, end: gold.end, replacement: encodeFor('css-theme', '#3ba9ff') },
    ]);

    const file = serializeBundle(b, { template: next });
    const again = parseBundle(file);
    expect(verifyRoundTrip(again).ok).toBe(true);

    const t2 = buildTargets(again.template, indexTemplate(again.template));
    expect([...t2.byId.values()].find((x) => x.prop === '--gold')!.current).toBe('#3ba9ff');
    expect(indexTemplate(again.template).strings.find((s) => s.tag === 'h1')!.value)
      .toBe('Fresh & bold');
    // Target counts are unchanged — nothing was structurally disturbed.
    expect(t2.byId.size).toBe(t.byId.size);
  });
});
