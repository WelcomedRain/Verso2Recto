import { describe, it, expect } from 'vitest';
import { reportFit, makeItCover, makeItFitByHeight, type FitMeasurement, type SweepPoint } from './fit';

/** The real Arcanum Resero card: a 16:9 image in a fixed-height, fluid frame. */
const base: FitMeasurement = {
  elementId: 'e1',
  intrinsic: [1280, 720],
  rendered: [338, 190],
  frame: [387, 190],
  objectFit: 'fill',
  inlineWidth: 'auto',
  inlineHeight: '100%',
  frameOverflow: 'hidden',
};

/** Measured from the live page across the widths it is used at. */
const realSweep: SweepPoint[] = [
  { viewport: 390, frameW: 336, frameH: 190 },
  { viewport: 600, frameW: 537, frameH: 190 },
  { viewport: 834, frameW: 376, frameH: 190 },
  { viewport: 1000, frameW: 301, frameH: 190 },
  { viewport: 1280, frameW: 387, frameH: 190 },
];

describe('reportFit, anchored by height', () => {
  it('recognises that the full height always shows', () => {
    const r = reportFit(base, realSweep);
    expect(r.anchor).toBe('height');
    expect(r.detail).toMatch(/full height always shows/);
  });

  it('requires the widest shape the frame ever takes, not the current one', () => {
    const r = reportFit(base, realSweep);
    // Current frame is 2.04:1, but at a 600px window it reaches 2.83:1.
    expect(r.frameAspect).toBe(2.04);
    expect(r.requiredAspect).toBe(2.83);
  });

  it('reports the box to cover, in the terms someone preparing a file needs', () => {
    const r = reportFit(base, realSweep);
    // Fixed height, fluid width — so one height and a maximum width.
    expect(r.frameHeightRange).toEqual([190, 190]);
    expect(r.frameWidthRange).toEqual([301, 537]);
    expect(r.detail).toMatch(/always 190px tall/);
    expect(r.detail).toMatch(/reaches 537px wide/);
    // And the rule that works for any height they pick.
    expect(r.detail).toMatch(/that height × 2\.83/);
  });

  it('says the height varies when it actually does', () => {
    const varying = [
      { viewport: 390, frameW: 336, frameH: 150 },
      { viewport: 1280, frameW: 537, frameH: 190 },
    ];
    expect(reportFit(base, varying).detail).toMatch(/between 150px and 190px tall/);
  });

  it('says how much of the width is safe for the subject', () => {
    const r = reportFit(base, realSweep);
    // Narrowest 1.58 against widest 2.83 — only the middle ~56% is ever shown.
    expect(r.safeCentreFraction).toBeCloseTo(0.56, 2);
    expect(r.detail).toMatch(/middle 56%/);
  });

  it('reports the gap the current image leaves', () => {
    const r = reportFit(base, realSweep);
    expect(r.verdict).toBe('gaps');
    expect(r.gapEachSide).toBe(25);
  });

  it('calls an image wide enough a fill', () => {
    // 3:1 at the same height clears the 2.83 requirement.
    const r = reportFit({ ...base, intrinsic: [1200, 400], rendered: [387, 190] }, realSweep);
    expect(r.verdict).toBe('fills');
    expect(r.headline).toMatch(/full height always shows/);
  });

  it('suggests a size at the required ratio, not the current one', () => {
    const r = reportFit(base, realSweep);
    const [w, h] = r.suggested!;
    expect(h).toBe(380);
    expect(w / h).toBeCloseTo(2.83, 1);
  });

  it('falls back to the current width when nothing was swept', () => {
    const r = reportFit(base);
    expect(r.requiredAspect).toBe(2.04);
  });
});

describe('reportFit, filling and cropping', () => {
  /**
   * The trap this exists to warn about: on a fixed-height frame, cover's
   * vertical crop grows as the window widens — which is the opposite of what
   * someone wants when they cropped the source so a face sits correctly.
   */
  it('warns how much cover trims vertically at its worst', () => {
    const r = reportFit({ ...base, objectFit: 'cover', rendered: [387, 190] }, realSweep);
    expect(r.anchor).toBe('cover');
    // At a 600px window the frame is 537x190; covering 1280x720 crops 112px.
    expect(r.detail).toMatch(/112px/);
    expect(r.headline).toMatch(/crops top and bottom/);
  });

  it('points back at fitting by height when the top of the subject matters', () => {
    const r = reportFit({ ...base, objectFit: 'cover', rendered: [387, 190] }, realSweep);
    expect(r.detail).toMatch(/fitting by height/);
  });
});

describe('reportFit, unmeasurable', () => {
  it('says so rather than guessing', () => {
    expect(reportFit({ ...base, frame: [0, 0] }).verdict).toBe('unknown');
    expect(reportFit({ ...base, intrinsic: [0, 0] }).verdict).toBe('unknown');
  });
});

describe('rewriting the img tag', () => {
  const real =
    '<img src="334f483d-88fe-4ad3-bde9-96b8fd0eeb18" alt="Arcanum Resero avatar mark" ' +
    'style="height:100%;width:auto;display:block">';

  it('makeItCover replaces the sizing and keeps everything else', () => {
    const out = makeItCover(real)!;
    expect(out).toContain('object-fit:cover');
    expect(out).toContain('display:block');
    expect(out).toContain('alt="Arcanum Resero avatar mark"');
    expect(out).not.toContain('width:auto');
  });

  it('makeItFitByHeight restores the height anchor', () => {
    const covered = makeItCover(real)!;
    const back = makeItFitByHeight(covered)!;
    expect(back).toContain('height:100%');
    expect(back).toContain('width:auto');
    expect(back).not.toContain('object-fit');
    expect(back).toContain('display:block');
  });

  it('round-trips to the same declarations it started with', () => {
    const back = makeItFitByHeight(makeItCover(real)!)!;
    const style = back.match(/style="([^"]*)"/)![1].split(';').sort().join(';');
    const orig = 'height:100%;width:auto;display:block'.split(';').sort().join(';');
    expect(style).toBe(orig);
  });

  it('returns null when it would change nothing', () => {
    expect(makeItFitByHeight(real)).toBe(null);
    expect(makeItCover('<img src="a.png" style="width:100%;height:100%;object-fit:cover">')).toBe(null);
  });

  it('returns null for something that is not a single img', () => {
    expect(makeItCover('<div></div>')).toBe(null);
    expect(makeItCover('<img src="a"> <img src="b">')).toBe(null);
  });

  it('preserves a self-closing tag and handles single quotes', () => {
    expect(makeItCover('<img src="a.png" />')!.endsWith('/>')).toBe(true);
    expect(makeItCover("<img src='a.png' style='height:100%'>")).toContain('object-fit:cover');
  });
});
