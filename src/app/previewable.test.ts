import { describe, it, expect } from 'vitest';
import { noteFor, summarise, type PreviewNote } from './previewable';

const change = (kind: Parameters<typeof noteFor>[0]['kind'], id = 't1') =>
  ({ targetId: id, label: 'h1 · colour', kind });

describe('noteFor', () => {
  it('says nothing when the page reports it is on screen', () => {
    const n = noteFor(change('text'), { result: 'shown' });
    expect(n.state).toBe('showing');
    expect(n.why).toBe('');
  });

  it('waits rather than accusing before the page has answered', () => {
    // Every keystroke re-pushes, so a missing ack is almost always a frame of
    // latency. Calling that "not shown" would cry wolf on every edit.
    expect(noteFor(change('text'), undefined).state).toBe('waiting');
  });

  it('repeats the page own reason when it could not apply the change', () => {
    const n = noteFor(change('attr'), { result: 'missing', why: 'No element with that id.' });
    expect(n.state).toBe('not-shown');
    expect(n.why).toBe('No element with that id.');
    expect(n.howToSee).toMatch(/still publish/);
  });

  it('distinguishes applied-but-invisible from not applied at all', () => {
    const hidden = noteFor(change('attr'), { result: 'hidden', why: 'It is a head tag.' });
    expect(hidden.state).toBe('not-shown');
    expect(hidden.why).toBe('It is a head tag.');
    expect(hidden.howToSee).toMatch(/Code/);
  });

  it('has a sentence of its own when the page reports no reason', () => {
    expect(noteFor(change('text'), { result: 'missing' }).why).not.toBe('');
    expect(noteFor(change('text'), { result: 'hidden' }).why).not.toBe('');
  });

  it('classifies a hover edit as held, without ever asking the page', () => {
    // The runtime consumed style-hover, so there is no ack to wait for and a
    // "waiting" that never resolves would be a lie.
    const n = noteFor(change('css-hover'), undefined);
    expect(n.state).toBe('hold');
    expect(n.howToSee).toMatch(/Hold hover/);
  });
});

describe('summarise', () => {
  const note = (state: PreviewNote['state'], id: string): PreviewNote =>
    ({ id, label: id, state, why: 'w', howToSee: 'h' });

  it('is silent when everything is on screen', () => {
    const s = summarise([note('showing', 'a'), note('waiting', 'b')]);
    expect(s.headline).toBe('');
    expect(s.notes).toEqual([]);
    expect(s.showing).toBe(1);
  });

  it('leads with what cannot be seen at all', () => {
    const s = summarise([note('hold', 'a'), note('not-shown', 'b'), note('not-shown', 'c')]);
    expect(s.headline).toMatch(/^2 changes are not visible/);
    expect(s.unseen).toBe(2);
    expect(s.held).toBe(1);
    // Unseen first: it is the one that needs acting on.
    expect(s.notes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('mentions held changes when they are the only exception', () => {
    expect(summarise([note('hold', 'a')]).headline).toMatch(/^1 change only shows/);
  });

  it('counts in the singular properly', () => {
    expect(summarise([note('not-shown', 'a')]).headline).toMatch(/^1 change is not visible/);
  });
});
