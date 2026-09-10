import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { validateFragment, encodeFor } from './targets';
import { parseBundle, serializeBundle, verifyRoundTrip } from './bundle';
import { indexTemplate, applyEdits, outerRange } from './htmlIndex';

const REAL = 'G:/Anthea-Solve/index.html';
const hasReal = existsSync(REAL);

describe('validateFragment', () => {
  it('accepts well-formed markup', () => {
    expect(validateFragment('<a href="#x">Hi</a>')).toBe(null);
    expect(validateFragment('<div><p>One</p><p>Two</p></div>')).toBe(null);
  });

  it('accepts void elements without closing tags', () => {
    expect(validateFragment('<div><img src="a.png"><br><hr></div>')).toBe(null);
  });

  it('accepts self-closing syntax', () => {
    expect(validateFragment('<div><span/></div>')).toBe(null);
  });

  /**
   * The failure worth refusing loudly: an unclosed tag does not break the page
   * visibly, it makes every following sibling a child of it.
   */
  it('refuses an unclosed tag and names it', () => {
    const msg = validateFragment('<div><p>text</div>');
    expect(msg).toMatch(/never closed/);
    expect(msg).toContain('<p>');
  });

  it('refuses a closing tag with nothing to close', () => {
    expect(validateFragment('<p>hi</p></div>')).toMatch(/nothing to close/);
  });

  it('refuses empty input rather than silently deleting the element', () => {
    expect(validateFragment('   ')).toMatch(/cannot be empty/);
  });

  it('refuses plain text, which would replace an element with a string', () => {
    expect(validateFragment('just words')).toMatch(/no tags/);
  });

  it('does not entity-encode markup on the way out', () => {
    const html = '<a href="?a=1&b=2">Tom & Jerry</a>';
    expect(encodeFor('html', html)).toBe(html);
  });
});

describe.skipIf(!hasReal)('editing a real element', () => {
  const source = hasReal ? readFileSync(REAL, 'utf8') : '';

  it('an element range covers exactly that element', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const h1 = idx.byId.get(idx.strings.find((s) => s.tag === 'h1')!.elementId)!;
    const { start, end } = outerRange(h1);
    const slice = b.template.slice(start, end);
    expect(slice.startsWith('<h1')).toBe(true);
    expect(slice.endsWith('</h1>')).toBe(true);
    expect(validateFragment(slice)).toBe(null);
  });

  it('every element range is inside its parent range', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    for (const el of idx.elements) {
      if (!el.parentId) continue;
      const parent = idx.byId.get(el.parentId);
      if (!parent) continue;
      const c = outerRange(el);
      const p = outerRange(parent);
      expect(c.start).toBeGreaterThanOrEqual(p.start);
      expect(c.end).toBeLessThanOrEqual(p.end);
    }
  });

  it('replacing an element rewrites only that element', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const h1 = idx.byId.get(idx.strings.find((s) => s.tag === 'h1')!.elementId)!;
    const { start, end } = outerRange(h1);
    const replacement = '<h1 style="font-size:40px">Rewritten by hand</h1>';

    const next = applyEdits(b.template, [
      { start, end, replacement: encodeFor('html', replacement) },
    ]);
    expect(next.length).toBe(b.template.length - (end - start) + replacement.length);

    const nextIdx = indexTemplate(next);
    expect(nextIdx.strings.find((s) => s.tag === 'h1')!.value).toBe('Rewritten by hand');
    // The paragraph that followed it is still there and still a sibling.
    expect(next).toContain('Anthea Solve is a one-person studio');
  });

  it('an element edit still round-trips through the bundle codec', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const el = idx.byId.get(idx.strings.find((s) => s.tag === 'h1')!.elementId)!;
    const { start, end } = outerRange(el);
    const next = applyEdits(b.template, [
      { start, end, replacement: '<h1>A & B <span>nested</span></h1>' },
    ]);
    const file = serializeBundle(b, { template: next });
    const again = parseBundle(file);
    expect(again.template).toBe(next);
    expect(verifyRoundTrip(again).ok).toBe(true);
  });

  it('rejects a fragment that would swallow the rest of the page', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const h1 = idx.byId.get(idx.strings.find((s) => s.tag === 'h1')!.elementId)!;
    const slice = b.template.slice(outerRange(h1).start, outerRange(h1).end);
    // Drop the closing tag, the classic hand-editing slip.
    expect(validateFragment(slice.replace('</h1>', ''))).toMatch(/never closed/);
  });
});
