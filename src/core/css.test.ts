import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseDeclarations, findThemeTokens, elementStyle, elementHoverStyle, hasHoverStyle, resolveVar } from './css';
import { parseBundle } from './bundle';
import { indexTemplate, applyEdits } from './htmlIndex';

const REAL = 'G:/Anthea-Solve/index.html';
const hasReal = existsSync(REAL);

describe('parseDeclarations', () => {
  it('splits a simple list', () => {
    const d = parseDeclarations('color:red;font-size:12px');
    expect(d.map((x) => [x.prop, x.value])).toEqual([['color', 'red'], ['font-size', '12px']]);
  });

  it('does not split inside parentheses', () => {
    const d = parseDeclarations('font-size:clamp(34px,5.2vw,68px);margin:0');
    expect(d).toHaveLength(2);
    expect(d[0].value).toBe('clamp(34px,5.2vw,68px)');
  });

  it('does not split inside quotes', () => {
    const d = parseDeclarations('font-family:"Archivo; fake",sans-serif;color:red');
    expect(d).toHaveLength(2);
    expect(d[0].value).toBe('"Archivo; fake",sans-serif');
  });

  it('does not treat a colon inside a value as the separator', () => {
    const d = parseDeclarations('background:url(data:image/png;base64,AAA)');
    expect(d[0].prop).toBe('background');
  });

  it('reports value ranges that slice back to the value', () => {
    const src = '  color : #ec3013 ; padding:4px';
    for (const d of parseDeclarations(src)) {
      expect(src.slice(d.valueStart, d.valueEnd)).toBe(d.value);
    }
  });

  it('offsets ranges by the base', () => {
    const d = parseDeclarations('color:red', 1000);
    expect(d[0].valueStart).toBe(1006);
  });

  it('ignores a trailing semicolon and blank segments', () => {
    expect(parseDeclarations('color:red;;')).toHaveLength(1);
  });
});

describe('resolveVar', () => {
  const tokens = [{ prop: '--gold', value: '#f2a81c' }] as any;
  it('resolves a var to its token value', () => {
    expect(resolveVar('var(--gold)', tokens)).toBe('#f2a81c');
  });
  it('falls back to the declared fallback', () => {
    expect(resolveVar('var(--missing, #123456)', tokens)).toBe('#123456');
  });
  it('passes a literal colour through', () => {
    expect(resolveVar('#0a0908', tokens)).toBe('#0a0908');
  });
  it('returns null for something that is not a colour', () => {
    expect(resolveVar('12px', tokens)).toBe(null);
  });
});

describe.skipIf(!hasReal)('against the real site', () => {
  const source = hasReal ? readFileSync(REAL, 'utf8') : '';

  it('finds the theme tokens', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const tokens = findThemeTokens(b.template, idx);
    const names = tokens.map((t) => t.prop);
    expect(names).toContain('--gold');
    expect(names).toContain('--ink');
    expect(names).toContain('--color-accent');
    expect(tokens.length).toBeGreaterThan(30);
  });

  it('every token range slices back to its value', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    for (const t of findThemeTokens(b.template, idx)) {
      expect(b.template.slice(t.valueStart, t.valueEnd)).toBe(t.value);
    }
  });

  it('classifies the site tokens as colours', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const tokens = findThemeTokens(b.template, idx);
    expect(tokens.find((t) => t.prop === '--gold')!.kind).toBe('color');
    expect(tokens.find((t) => t.prop === '--wordmark')!.kind).toBe('font');
  });

  it('changing one theme token rewrites only that value', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const gold = findThemeTokens(b.template, idx).find((t) => t.prop === '--gold')!;
    const next = applyEdits(b.template, [
      { start: gold.valueStart, end: gold.valueEnd, replacement: '#00ff00' },
    ]);
    expect(next.length).toBe(b.template.length - gold.value.length + 7);
    const after = findThemeTokens(next, indexTemplate(next)).find((t) => t.prop === '--gold')!;
    expect(after.value).toBe('#00ff00');
    // The other tokens are untouched.
    expect(findThemeTokens(next, indexTemplate(next)).find((t) => t.prop === '--ink')!.value)
      .toBe('#0a0908');
  });

  it('reads the hero heading inline styles', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const h1 = idx.strings.find((s) => s.tag === 'h1')!;
    const decls = elementStyle(idx.byId.get(h1.elementId)!);
    const props = decls.map((d) => d.prop);
    expect(props).toContain('font-size');
    expect(props).toContain('line-height');
    for (const d of decls) {
      expect(b.template.slice(d.valueStart, d.valueEnd)).toBe(d.value);
    }
  });

  it('patching one declaration leaves the rest of the attribute intact', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const h1El = idx.byId.get(idx.strings.find((s) => s.tag === 'h1')!.elementId)!;
    const fs = elementStyle(h1El).find((d) => d.prop === 'font-size')!;
    const next = applyEdits(b.template, [
      { start: fs.valueStart, end: fs.valueEnd, replacement: '40px' },
    ]);
    const nextIdx = indexTemplate(next);
    const nextEl = nextIdx.byId.get(nextIdx.strings.find((s) => s.tag === 'h1')!.elementId)!;
    const after = elementStyle(nextEl);
    expect(after.find((d) => d.prop === 'font-size')!.value).toBe('40px');
    expect(after.find((d) => d.prop === 'line-height')!.value).toBe('1.03');
    expect(after).toHaveLength(elementStyle(h1El).length);
  });

  it('finds the hover styles the editor could not previously see', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const hovering = idx.elements.filter(hasHoverStyle);
    expect(hovering.length).toBeGreaterThanOrEqual(10);

    // Every hover range must slice back to its own value, exactly as the base
    // styles do — same machinery, so the same guarantee.
    for (const el of hovering) {
      for (const d of elementHoverStyle(el)) {
        expect(b.template.slice(d.valueStart, d.valueEnd)).toBe(d.value);
        expect(d.state).toBe('hover');
      }
    }
  });

  it('keeps base and hover declarations apart', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const el = idx.elements.find(hasHoverStyle)!;
    const base = elementStyle(el);
    const hover = elementHoverStyle(el);
    expect(base.every((d) => d.state === 'base')).toBe(true);
    // Ids must not collide, or one would overwrite the other in the target map.
    const ids = new Set([...base, ...hover].map((d) => d.id));
    expect(ids.size).toBe(base.length + hover.length);
    // And their ranges must not overlap.
    for (const bd of base) for (const hd of hover) {
      expect(bd.valueEnd <= hd.valueStart || hd.valueEnd <= bd.valueStart).toBe(true);
    }
  });

  it('editing a hover value leaves the base style untouched', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const el = idx.elements.find((e) => hasHoverStyle(e) && elementStyle(e).length > 0)!;
    const hv = elementHoverStyle(el)[0];
    const baseBefore = elementStyle(el).map((d) => `${d.prop}:${d.value}`);
    const next = applyEdits(b.template, [
      { start: hv.valueStart, end: hv.valueEnd, replacement: '#00ff00' },
    ]);
    const nextIdx = indexTemplate(next);
    const nextEl = nextIdx.elements.find((e) => e.path === el.path)!;
    expect(elementHoverStyle(nextEl)[0].value).toBe('#00ff00');
    expect(elementStyle(nextEl).map((d) => `${d.prop}:${d.value}`)).toEqual(baseBefore);
  });

  it('finds inline styles on a large share of elements', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const styled = idx.elements.filter((e) => elementStyle(e).length > 0);
    expect(styled.length).toBeGreaterThan(100);
  });
});
