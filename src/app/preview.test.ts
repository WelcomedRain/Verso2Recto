import { describe, it, expect } from 'vitest';
import { frameSizing, fillZoom, DEVICE_WIDTH } from './preview';

describe('frameSizing', () => {
  /**
   * The defect this suite exists for: the frame used to take `width: 100%`
   * whenever the pane was wider than the chosen device. A ~460px pane is wider
   * than a 390px phone, so picking Phone or Tablet changed nothing at all and
   * the buttons appeared inert.
   */
  it('honours Phone even when the pane is wider than the phone', () => {
    const s = frameSizing('phone', 'fill', 460, 700);
    expect(s.width).toBe(DEVICE_WIDTH.phone);
    expect(s.width).not.toBe('100%');
  });

  it('honours Tablet even when the pane is much wider', () => {
    expect(frameSizing('tablet', 'fill', 1600, 900).width).toBe(DEVICE_WIDTH.tablet);
  });

  it('honours Phone at any zoom', () => {
    expect(frameSizing('phone', 1, 1600, 900).width).toBe(DEVICE_WIDTH.phone);
    expect(frameSizing('phone', 0.5, 200, 900).width).toBe(DEVICE_WIDTH.phone);
  });

  it('gives the three presets three different widths', () => {
    const widths = (['desktop', 'tablet', 'phone'] as const)
      .map((d) => frameSizing(d, 'fill', 500, 700).width);
    expect(new Set(widths).size).toBe(3);
  });

  it('lets Desktop fill a pane wider than itself, rather than leaving dead space', () => {
    const s = frameSizing('desktop', 'fill', 1600, 900);
    expect(s.width).toBe('100%');
    expect(s.scale).toBe(1);
  });

  it('does not let Desktop fill when the user set an explicit zoom', () => {
    expect(frameSizing('desktop', 1, 1600, 900).width).toBe(DEVICE_WIDTH.desktop);
  });

  it('scales a device down to fit a narrow pane', () => {
    const s = frameSizing('desktop', 'fill', 640, 800);
    expect(s.scale).toBeCloseTo(640 / 1280, 5);
    expect(s.width).toBe(DEVICE_WIDTH.desktop);
  });

  it('makes the frame tall enough that the page fills the pane after scaling', () => {
    const s = frameSizing('desktop', 'fill', 640, 800);
    // height * scale should come back to the pane height.
    expect(s.height * s.scale).toBeCloseTo(800, 0);
  });

  it('never returns a zero or negative height', () => {
    for (const paneH of [0, -10, 5]) {
      expect(frameSizing('phone', 'fill', 400, paneH).height).toBeGreaterThanOrEqual(240);
    }
  });
});

describe('fillZoom', () => {
  it('fits width only and never magnifies past 1', () => {
    expect(fillZoom(2000, 1280)).toBe(1);
    expect(fillZoom(640, 1280)).toBeCloseTo(0.5, 5);
  });

  it('has a floor so a collapsed pane cannot produce zoom 0', () => {
    expect(fillZoom(1, 1280)).toBe(0.08);
  });

  it('survives an unmeasured pane', () => {
    expect(fillZoom(0, 1280)).toBe(1);
  });
});
