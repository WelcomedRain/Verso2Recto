import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { frameSizing, fillZoom, DEVICE_WIDTH, buildPreviewDoc } from './preview';
import { indexTemplate } from '../core/htmlIndex';
import { parseBundle } from '../core/bundle';

/**
 * The bridge is a string, so TypeScript cannot see inside it.
 *
 * Two breakages proved the point within an hour of each other: a backtick in a
 * comment silently ended the String.raw literal, and an apostrophe inside a
 * single-quoted message ended the string. Neither failed the build. Both left
 * the preview completely dead, with the app still compiling and 154 tests still
 * passing.
 */
describe('the injected bridge', () => {
  const source = readFileSync(new URL('./preview.ts', import.meta.url), 'utf8');

  const bridgeJs = () => {
    const m = source.match(/const BRIDGE = String\.raw`([\s\S]*?)\n`;/);
    expect(m, 'could not find the BRIDGE literal').toBeTruthy();
    return m![1].replace(/^[\s\S]*?<script>/, '').replace(/<\/script>[\s\S]*$/, '');
  };

  it('is syntactically valid JavaScript', () => {
    expect(() => new Function(bridgeJs())).not.toThrow();
  });

  it('answers every message it is sent', () => {
    // A handler that applies a change but never acknowledges it is the silent
    // failure this feature exists to remove, so absence of an ack is a defect.
    const js = bridgeJs();
    const handled = [...js.matchAll(/m\.type === '(recto:[\w-]+)'/g)].map((x) => x[1]);
    expect(handled.length).toBeGreaterThan(5);
    // These change what is drawn, so each must report what it did.
    for (const t of ['recto:set-text', 'recto:set-attr', 'recto:set-style',
                     'recto:set-style-attr', 'recto:set-html', 'recto:set-rule',
                     'recto:set-theme']) {
      expect(handled, `${t} is not handled`).toContain(t);
      const body = js.slice(js.indexOf(`m.type === '${t}'`));
      const end = body.indexOf("m.type === 'recto:", 20);
      expect(end === -1 ? body : body.slice(0, end)).toMatch(/ack\(/);
    }
  });

  // Against the real export, and skipped when it is not on this machine — the
  // same rule the rest of the suite follows. A synthetic fixture here would
  // hide format drift, which is the whole risk.
  const REAL = 'G:/Anthea-Solve/index.html';
  it.skipIf(!existsSync(REAL))('does not leak the bridge into the published page', () => {
    // The tagged document is a preview artefact. If it ever reached the
    // publish path the site would ship an editor inside itself.
    const file = readFileSync(REAL, 'utf8');
    const doc = buildPreviewDoc(file, indexTemplate(parseBundle(file).template));
    expect(doc).toContain('__recto_bridge_style');
    expect(file).not.toContain('__recto_bridge_style');
  });
});

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
