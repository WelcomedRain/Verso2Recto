import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { verifyHeadTags, editsFor, publish, type PendingChange } from './publish';
import { parseBundle } from './bundle';
import { indexTemplate } from './htmlIndex';
import { buildTargets } from './targets';

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
    const targets = buildTargets(b.template, idx);
    const h1 = idx.strings.find((s) => s.tag === 'h1')!;
    const change: PendingChange = {
      targetId: h1.id, file: 'index.html', label: h1.label, tag: h1.tag, kind: 'text',
      liveValue: h1.value, nextValue: 'New & improved',
    };
    const [edit] = editsFor([change], targets.byId);
    expect(edit.start).toBe(h1.start);
    expect(edit.replacement).toBe('New &amp; improved');
  });

  it('refuses a change whose position was lost rather than guessing', () => {
    const change: PendingChange = {
      targetId: 'gone', file: 'index.html', label: 'x', tag: 'p', kind: 'text',
      liveValue: 'a', nextValue: 'b',
    };
    expect(() => editsFor([change], new Map())).toThrow(/position in the page was lost/);
  });
});

/**
 * Publishing with no connection.
 *
 * The dialog used to say "It will publish itself when you are back online" and
 * the step list marked Pushed as done. Neither was true: the `online` listener
 * only flips a flag, and nothing in the app retries a publish. No work was ever
 * lost — the queue survives, because the baseline is only reset on a real push
 * — but being told it was handled is the reason you would not go back and
 * press the button.
 */
describe.skipIf(!hasReal)('publishing while offline', () => {
  const inputFor = (online: boolean) => {
    const originalFile = readFileSync(REAL, 'utf8');
    const bundle = parseBundle(originalFile);
    return {
      ref: { owner: 'o', repo: 'r', branch: 'main' },
      token: 'unused-while-offline',
      originalFile,
      path: 'index.html',
      changes: [] as PendingChange[],
      targets: buildTargets(bundle.template, indexTemplate(bundle.template)).byId,
      message: 'test',
      online,
    };
  };

  it('does not mark the push as done when nothing was pushed', async () => {
    const r = await publish(inputFor(false), () => {});
    expect(r.outcome).toBe('queued');
    const pushed = r.steps.find((s) => s.id === 'pushed')!;
    expect(pushed.state).not.toBe('done');
    expect(pushed.state).not.toBe('failed');
  });

  it('does not claim it will send the work later', async () => {
    const r = await publish(inputFor(false), () => {});
    const said = r.steps.map((s) => `${s.label} ${s.note}`).join(' ').toLowerCase();
    expect(said).not.toMatch(/will publish|itself|automatic/);
  });

  it('still gets far enough to prove the page would publish cleanly', async () => {
    // The offline attempt is worth making: everything up to the send is real
    // verification, including the head-tag gate.
    const r = await publish(inputFor(false), () => {});
    for (const id of ['written', 'rebuilt', 'spliced', 'verified']) {
      expect(r.steps.find((s) => s.id === id)!.state, id).toBe('done');
    }
    expect(r.fileText, 'the rebuilt page is kept').toBeTruthy();
  });
});
