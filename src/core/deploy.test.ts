import { describe, it, expect, vi } from 'vitest';
import { verifyDeployment, deployLabel, liveUrlFor } from './deploy';

const noSleep = () => Promise.resolve();
const res = (body: string, ok = true, status = 200) =>
  ({ ok, status, text: () => Promise.resolve(body) }) as Response;

describe('verifyDeployment', () => {
  it('reports verified only on an exact match', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res('PUBLISHED'));
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/', expected: 'PUBLISHED', fetchImpl, sleepImpl: noSleep,
    });
    expect(o.state).toBe('verified');
    expect(o.attempts).toBe(1);
  });

  it('does NOT report verified when the live site is close but different', async () => {
    // The failure this guards: a near-match is exactly what a half-rolled-out
    // or failed deploy looks like from outside.
    const fetchImpl = vi.fn().mockResolvedValue(res('PUBLISHED '));
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/', expected: 'PUBLISHED',
      fetchImpl, sleepImpl: noSleep, timeoutMs: 30, intervalMs: 1,
    });
    expect(o.state).not.toBe('verified');
  });

  it('keeps polling until the new version appears', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res('OLD'))
      .mockResolvedValueOnce(res('OLD'))
      .mockResolvedValueOnce(res('NEW'));
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/', expected: 'NEW', fetchImpl, sleepImpl: noSleep,
    });
    expect(o.state).toBe('verified');
    expect(o.attempts).toBe(3);
  });

  it('reports pending, never failed, when the site never catches up', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res('OLD'));
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/', expected: 'NEW',
      fetchImpl, sleepImpl: noSleep, timeoutMs: 20, intervalMs: 1,
    });
    expect(o.state).toBe('pending');
    expect(o.detail).toMatch(/has not picked up/);
  });

  it('treats an unreachable live site as unobserved, not as a failed push', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/', expected: 'NEW',
      fetchImpl, sleepImpl: noSleep, timeoutMs: 20, intervalMs: 1,
    });
    expect(o.detail).toMatch(/push itself succeeded/);
    expect(o.state).not.toBe('stale');
  });

  it('cache-busts, or a cached copy would read as never deploying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res('NEW'));
    await verifyDeployment({
      liveUrl: 'https://x.test/', expected: 'NEW', fetchImpl, sleepImpl: noSleep,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('__recto=');
    expect(init).toMatchObject({ cache: 'no-store' });
  });

  it('stops when aborted', async () => {
    const c = new AbortController();
    c.abort();
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/', expected: 'NEW',
      fetchImpl: vi.fn(), sleepImpl: noSleep, signal: c.signal,
    });
    expect(o.state).toBe('unknown');
  });

  it('does not call a non-200 response a deployment', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res('', false, 404));
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/', expected: 'NEW',
      fetchImpl, sleepImpl: noSleep, timeoutMs: 20, intervalMs: 1,
    });
    expect(o.state).toBe('pending');
  });
});

describe('deployLabel', () => {
  it('never claims live before it was observed', () => {
    expect(deployLabel(null, Date.now())).toBe('Pushed to GitHub');
    expect(deployLabel(null, null)).toMatch(/matches the live site/);
  });
  it('distinguishes pushed from live', () => {
    const at = { checkedAt: 0, attempts: 1 };
    expect(deployLabel({ state: 'verified', detail: '', ...at }, 1)).toMatch(/serving your change/);
    expect(deployLabel({ state: 'stale', detail: '', ...at }, 1)).toMatch(/not caught up/);
    expect(deployLabel({ state: 'unknown', detail: '', ...at }, 1)).toMatch(/could not check/i);
  });
});

describe('liveUrlFor', () => {
  it('prefers the repository CNAME', () => {
    expect(liveUrlFor('antheasolve.com\n', 'WelcomedRain', 'Anthea-Solve', 'index.html'))
      .toBe('https://antheasolve.com/');
  });
  it('falls back to the Pages default', () => {
    expect(liveUrlFor(undefined, 'WelcomedRain', 'Anthea-Solve', 'index.html'))
      .toBe('https://welcomedrain.github.io/Anthea-Solve/');
  });
  it('accounts for a page in a subfolder', () => {
    expect(liveUrlFor('example.com', 'o', 'r', 'site/index.html'))
      .toBe('https://example.com/site/');
  });
});

/**
 * The first real publish went to the staged copy, and the dialog reported "The
 * live site is serving your change." The live page had never been touched. The
 * strings were hardcoded to the only destination that existed when they were
 * written, which made them a false statement about the one page this editor
 * exists to protect the moment a second destination appeared.
 */
describe('what the observation says it checked', () => {
  const res = (body: string) => ({ ok: true, status: 200, text: async () => body }) as Response;
  const noSleep = async () => {};

  it('never mentions the live site when it checked the preview', async () => {
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/preview/', expected: 'P', subject: 'the preview',
      fetchImpl: vi.fn().mockResolvedValue(res('P')), sleepImpl: noSleep,
    });
    expect(o.state).toBe('verified');
    expect(o.detail).toBe('The preview is serving your change.');
    expect(o.detail).not.toMatch(/live/i);
  });

  it('says so in every outcome, not only the happy one', async () => {
    const bad = { ok: false, status: 404, text: async () => '' } as Response;
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/preview/', expected: 'P', subject: 'the preview',
      fetchImpl: vi.fn().mockResolvedValue(bad), sleepImpl: noSleep,
      timeoutMs: 30, intervalMs: 1,
    });
    expect(o.detail).not.toMatch(/live/i);

    const unreachable = await verifyDeployment({
      liveUrl: 'https://x.test/preview/', expected: 'P', subject: 'the preview',
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')), sleepImpl: noSleep,
      timeoutMs: 30, intervalMs: 1,
    });
    expect(unreachable.detail).not.toMatch(/live/i);
  });

  it('still speaks of the live site by default', async () => {
    const o = await verifyDeployment({
      liveUrl: 'https://x.test/', expected: 'P',
      fetchImpl: vi.fn().mockResolvedValue(res('P')), sleepImpl: noSleep,
    });
    expect(o.detail).toBe('The live site is serving your change.');
  });
});
