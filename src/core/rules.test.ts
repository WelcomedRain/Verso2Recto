import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { findRules, findThemeTokens } from './css';
import { parseBundle } from './bundle';
import { indexTemplate, applyEdits } from './htmlIndex';

const REAL = 'G:/Anthea-Solve/index.html';
const hasReal = existsSync(REAL);

function idx(t: string) { return indexTemplate(t); }

describe('findRules', () => {
  const wrap = (css: string) => `<html><head><style>${css}</style></head><body></body></html>`;

  it('finds a simple rule and its declarations', () => {
    const t = wrap('.btn { color: red; padding: 4px }');
    const [r] = findRules(t, idx(t));
    expect(r.selector).toBe('.btn');
    expect(r.decls.map((d) => d.prop)).toEqual(['color', 'padding']);
  });

  it('reports ranges that slice back to the value', () => {
    const t = wrap('.btn { color: red; padding: 4px }');
    for (const r of findRules(t, idx(t))) {
      for (const d of r.decls) expect(t.slice(d.valueStart, d.valueEnd)).toBe(d.value);
    }
  });

  it('separates the pseudo state from the selector it matches on', () => {
    const t = wrap('.btn:hover { color: blue }');
    const [r] = findRules(t, idx(t));
    expect(r.selector).toBe('.btn:hover');
    expect(r.matchSelector).toBe('.btn');
    expect(r.state).toBe('hover');
  });

  it('records the condition a rule sits under', () => {
    const t = wrap('@media (max-width: 600px) { .btn { color: green } }');
    const [r] = findRules(t, idx(t));
    expect(r.conditions).toEqual(['@media (max-width: 600px)']);
    expect(r.selector).toBe('.btn');
  });

  it('skips @font-face and @keyframes, which have nothing to select', () => {
    const t = wrap('@font-face { font-family: X; src: url(a.woff2) } @keyframes k { from { opacity: 0 } } .btn { color: red }');
    expect(findRules(t, idx(t)).map((r) => r.selector)).toEqual(['.btn']);
  });

  it('excludes :root, whose values the Theme panel already owns', () => {
    const t = wrap(':root { --gold: #f2a81c } .btn { color: var(--gold) }');
    expect(findRules(t, idx(t)).map((r) => r.selector)).toEqual(['.btn']);
  });

  it('is not fooled by braces inside comments or strings', () => {
    const t = wrap('/* } not a close { */ .a { content: "}{" ; color: red } .b { color: blue }');
    const rules = findRules(t, idx(t));
    expect(rules.map((r) => r.selector)).toEqual(['.a', '.b']);
    expect(rules[1].decls[0].value).toBe('blue');
  });
});

describe.skipIf(!hasReal)('the real stylesheet', () => {
  const source = hasReal ? readFileSync(REAL, 'utf8') : '';

  it('finds the component rules the editor could not reach', () => {
    const b = parseBundle(source);
    const rules = findRules(b.template, idx(b.template));
    const sels = rules.map((r) => r.selector);
    expect(sels).toContain('.btn-primary');
    expect(sels.some((s) => s.includes(':hover'))).toBe(true);
    expect(rules.length).toBeGreaterThan(40);
  });

  it('every rule declaration range slices back to its value', () => {
    const b = parseBundle(source);
    for (const r of findRules(b.template, idx(b.template))) {
      for (const d of r.decls) {
        expect(b.template.slice(d.valueStart, d.valueEnd)).toBe(d.value);
      }
    }
  });

  it('rule ranges never overlap theme token ranges', () => {
    const b = parseBundle(source);
    const i = idx(b.template);
    const spans = [
      ...findRules(b.template, i).flatMap((r) => r.decls),
      ...findThemeTokens(b.template, i),
    ].sort((a, x) => a.valueStart - x.valueStart);
    for (let k = 1; k < spans.length; k++) {
      expect(spans[k].valueStart).toBeGreaterThanOrEqual(spans[k - 1].valueEnd);
    }
  });

  it('editing a rule changes only that declaration', () => {
    const b = parseBundle(source);
    const rules = findRules(b.template, idx(b.template));
    const btn = rules.find((r) => r.selector === '.btn-primary')!;
    const first = btn.decls[0];
    const next = applyEdits(b.template, [
      { start: first.valueStart, end: first.valueEnd, replacement: 'magenta' },
    ]);
    const after = findRules(next, idx(next)).find((r) => r.selector === '.btn-primary')!;
    expect(after.decls[0].value).toBe('magenta');
    expect(after.decls.length).toBe(btn.decls.length);
    expect(next.length).toBe(b.template.length - first.value.length + 'magenta'.length);
  });
});
