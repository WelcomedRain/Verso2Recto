import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { verifyHeadTags, editsFor, type PendingChange } from './publish';
import { parseBundle } from './bundle';
import { indexTemplate } from './htmlIndex';

const REAL = 'G:/Anthea-Solve/index.html';
const hasReal = existsSync(REAL);

describe('the publish gate', () => {
  const good = `<!DOCTYPE html><html><head>
    <!-- static-head:begin -->
    <meta name="description" content="x">
    <meta property="og:title" content="x">
    <meta property="og:description" content="x">
    <meta property="og:url" content="x">
    <meta name="twitter:card" content="x">
    <link rel="canonical" href="x">
    <link rel="icon" href="x">
    <meta name="author" content="x">
    <!-- static-head:end -->
  </head><body>hi</body></html>`;

  it('passes a correctly spliced page', () => {
    const r = verifyHeadTags(good);
    expect(r.ok).toBe(true);
    expect(r.tagCount).toBeGreaterThanOrEqual(8);
  });

  it('fails when the block is in <body> — the real defect this guards', () => {
    const bad = good
      .replace(/<!-- static-head:begin -->[\s\S]*?<!-- static-head:end -->/, '')
      .replace('<body>', '<body><!-- static-head:begin --><meta property="og:title" content="x"><!-- static-head:end -->');
    const r = verifyHeadTags(bad);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('outside <head>');
  });

  it('fails when the block is missing entirely', () => {
    const bad = good.replace(/<!-- static-head:begin -->[\s\S]*?<!-- static-head:end -->/, '');
    expect(verifyHeadTags(bad).ok).toBe(false);
    expect(verifyHeadTags(bad).detail).toContain('missing entirely');
  });

  it('fails when there is no head at all', () => {
    expect(verifyHeadTags('<html><body>hi</body></html>').ok).toBe(false);
  });

  it('fails when the Open Graph tags were stripped but others remain', () => {
    const bad = good.replace(/<meta property="og:[^>]*>/g, '<meta name="filler" content="x">');
    const r = verifyHeadTags(bad);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('Open Graph');
  });

  it.skipIf(!hasReal)('passes the real antheasolve.com file as it stands today', () => {
    const r = verifyHeadTags(readFileSync(REAL, 'utf8'));
    expect(r.ok).toBe(true);
  });
});

describe('editsFor', () => {
  it.skipIf(!hasReal)('maps a change onto the right byte range', () => {
    const b = parseBundle(readFileSync(REAL, 'utf8'));
    const idx = indexTemplate(b.template);
    const h1 = idx.strings.find((s) => s.tag === 'h1')!;
    const change: PendingChange = {
      stringId: h1.id, file: 'index.html', label: h1.label, tag: h1.tag,
      liveValue: h1.value, nextValue: 'New & improved',
    };
    const [edit] = editsFor([change], idx.stringsById);
    expect(edit.start).toBe(h1.start);
    expect(edit.replacement).toBe('New &amp; improved');
  });

  it('refuses a change whose position was lost rather than guessing', () => {
    const change: PendingChange = {
      stringId: 'gone', file: 'index.html', label: 'x', tag: 'p',
      liveValue: 'a', nextValue: 'b',
    };
    expect(() => editsFor([change], new Map())).toThrow(/position in the page was lost/);
  });
});
