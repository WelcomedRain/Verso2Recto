import { describe, it, expect } from 'vitest';
import { statusLine, publishTarget } from './status';

const base = {
  dirty: 0, networkUp: true, manualOffline: false,
  liveUrl: 'https://antheasolve.com/', deploy: null, lastPush: null,
};

describe('the status line', () => {
  /**
   * The defect: "Editing a copy — the live site is untouched" was rendered
   * only while dirty > 0. Publish, and the one permanent fact about how this
   * app works vanished — so the reassurance read as a property of having
   * unsaved work rather than of the app.
   */
  it('says you are editing a copy whether or not anything is queued', () => {
    expect(statusLine({ ...base, dirty: 0 }).mode).toBe(statusLine({ ...base, dirty: 3 }).mode);
    expect(statusLine({ ...base, dirty: 0 }).mode).toMatch(/copy/i);
  });

  it('names where Publish would send the work, before it is pressed', () => {
    // The only irreversible outward-facing act in the app never said out loud
    // where it was aimed.
    expect(statusLine({ ...base, dirty: 2 }).pending).toContain('antheasolve.com');
  });

  it('counts one change without the plural, pronoun included', () => {
    expect(statusLine({ ...base, dirty: 1 }).pending).toBe(
      '1 change waiting · Publish sends it to antheasolve.com');
    expect(statusLine({ ...base, dirty: 2 }).pending).toBe(
      '2 changes waiting · Publish sends them to antheasolve.com');
  });

  it('falls back to the deployment state when nothing is queued', () => {
    expect(statusLine({ ...base, dirty: 0, lastPush: 1 }).pending).toMatch(/GitHub/);
  });

  it('still reports the count when the destination is not known yet', () => {
    const s = statusLine({ ...base, dirty: 2, liveUrl: null });
    expect(s.pending).toContain('2 changes waiting');
    expect(s.pending).not.toContain('undefined');
  });

  /**
   * `online` was one flag for two unrelated facts: the network being
   * reachable, and a manual switch in the header meant for testing. Flipping
   * the switch and forgetting showed "Offline" on a working connection, and
   * the screen could not tell you which one you were looking at.
   */
  it('distinguishes the test switch from a real outage', () => {
    const switched = statusLine({ ...base, manualOffline: true });
    const lost = statusLine({ ...base, networkUp: false });
    expect(switched.connection?.tone).toBe('switched');
    expect(lost.connection?.tone).toBe('lost');
    expect(switched.connection?.text).not.toBe(lost.connection?.text);
    expect(switched.connection?.text).toMatch(/you switched/i);
  });

  it('says nothing about the connection while it is working', () => {
    expect(statusLine(base).connection).toBeNull();
  });

  it('blames the switch, not the network, when both are set', () => {
    // The switch is the one he can undo, so it is the one worth naming.
    expect(statusLine({ ...base, manualOffline: true, networkUp: false }).connection?.tone)
      .toBe('switched');
  });
});

describe('publishTarget', () => {
  it('reduces the live URL to something a person would say out loud', () => {
    expect(publishTarget('https://antheasolve.com/')).toBe('antheasolve.com');
    expect(publishTarget('https://welcomedrain.github.io/Anthea-Solve/'))
      .toBe('welcomedrain.github.io');
  });

  it('survives a missing or malformed URL', () => {
    expect(publishTarget(null)).toBeNull();
    expect(publishTarget('not a url')).toBeNull();
  });
});
