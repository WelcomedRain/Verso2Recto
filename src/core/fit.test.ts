import { describe, it, expect } from 'vitest';
import { reportFit, makeItCover, type FitMeasurement } from './fit';

const base: FitMeasurement = {
  elementId: 'e1',
  intrinsic: [1280, 720],
  rendered: [338, 190],
  frame: [387, 190],
  objectFit: 'fill',
  frameOverflow: 'hidden',
};

describe('reportFit', () => {
  /** The real case: a 16:9 image in a fluid frame that wants about 2:1. */
  it('reports the gap and says why a single ratio cannot fix it', () => {
    const r = reportFit(base);
    expect(r.verdict).toBe('gaps');
    expect(r.gapEachSide).toBe(25);
    expect(r.headline).toContain('25px');
    expect(r.imageAspect).toBe(1.78);
    expect(r.frameAspect).toBe(2.04);
    expect(r.detail).toMatch(/no single ratio/);
  });

  it('calls it filled when the image matches the frame', () => {
    const r = reportFit({ ...base, intrinsic: [2040, 1000], rendered: [387, 190] });
    expect(r.verdict).toBe('fills');
  });

  it('warns about trimmed edges when the image overflows', () => {
    const r = reportFit({ ...base, rendered: [500, 190] });
    expect(r.verdict).toBe('crops');
    expect(r.detail).toMatch(/away from the left and right/);
  });

  it('stops caring about ratio once the frame crops', () => {
    const r = reportFit({ ...base, objectFit: 'cover', rendered: [387, 190] });
    expect(r.verdict).toBe('fills');
    expect(r.cropsAutomatically).toBe(true);
    expect(r.headline).toMatch(/any shape/);
  });

  it('suggests twice the frame width, at the frame ratio', () => {
    const r = reportFit(base);
    expect(r.suggested).toEqual([774, 379]);
  });

  it('says so rather than guessing when it cannot measure', () => {
    expect(reportFit({ ...base, frame: [0, 0] }).verdict).toBe('unknown');
    expect(reportFit({ ...base, intrinsic: [0, 0] }).verdict).toBe('unknown');
  });
});

describe('makeItCover', () => {
  const real =
    '<img src="334f483d-88fe-4ad3-bde9-96b8fd0eeb18" alt="Arcanum Resero avatar mark" ' +
    'style="height:100%;width:auto;display:block">';

  it('replaces the sizing while keeping everything else', () => {
    const out = makeItCover(real)!;
    expect(out).toContain('width:100%');
    expect(out).toContain('height:100%');
    expect(out).toContain('object-fit:cover');
    expect(out).toContain('display:block');
    // Nothing else about the tag may change.
    expect(out).toContain('src="334f483d-88fe-4ad3-bde9-96b8fd0eeb18"');
    expect(out).toContain('alt="Arcanum Resero avatar mark"');
    expect(out).not.toContain('width:auto');
  });

  it('is valid markup that still parses as one img', () => {
    const out = makeItCover(real)!;
    expect(out.startsWith('<img')).toBe(true);
    expect(out.endsWith('>')).toBe(true);
    expect((out.match(/<img/g) ?? []).length).toBe(1);
  });

  it('works on an img with no style at all', () => {
    const out = makeItCover('<img src="a.png" alt="x">')!;
    expect(out).toContain('object-fit:cover');
    expect(out).toContain('alt="x"');
  });

  it('handles single-quoted style attributes', () => {
    const out = makeItCover("<img src='a.png' style='height:100%'>")!;
    expect(out).toBe('<img src=\'a.png\' style="width:100%;height:100%;object-fit:cover">');
    // The old attribute is gone rather than sitting alongside a second one.
    expect((out.match(/style\s*=/g) ?? []).length).toBe(1);
  });

  it('returns null when it would change nothing', () => {
    const already = '<img src="a.png" style="width:100%;height:100%;object-fit:cover">';
    expect(makeItCover(already)).toBe(null);
  });

  it('returns null for something that is not an img tag', () => {
    expect(makeItCover('<div></div>')).toBe(null);
    expect(makeItCover('<img src="a"> <img src="b">')).toBe(null);
  });

  it('preserves a self-closing tag', () => {
    const out = makeItCover('<img src="a.png" />')!;
    expect(out.endsWith('/>')).toBe(true);
  });
});
