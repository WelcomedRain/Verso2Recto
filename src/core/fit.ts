/**
 * How an image sits in the frame the page gives it.
 *
 * The question is "what should the replacement be?", which the image alone
 * cannot answer: the frame is laid out by the cascade and is usually fluid, so
 * the useful advice is about ratio, not pixels — and it depends on how the
 * image is anchored in its frame.
 *
 * That anchoring distinction is the whole point of this file. A frame with a
 * fixed height and a fluid width, holding an image at `height:100%;width:auto`,
 * shows the image's full height at every window width and trims the sides. That
 * is a guarantee worth keeping: it is what lets someone crop a photograph so a
 * face is framed correctly and trust that it stays framed. `object-fit:cover`
 * throws that guarantee away — it crops whichever axis overflows, and on a
 * fixed-height frame the vertical crop grows as the window widens.
 */

export interface FitMeasurement {
  elementId: string;
  intrinsic: [number, number];
  rendered: [number, number];
  frame: [number, number];
  objectFit: string;
  /** The declared width/height, e.g. `auto` or `100%`. */
  inlineWidth?: string;
  inlineHeight?: string;
  frameOverflow: string;
}

/** The frame measured at a range of window widths. */
export interface SweepPoint {
  viewport: number;
  frameW: number;
  frameH: number;
}

export type FitAnchor = 'height' | 'width' | 'cover' | 'contain' | 'stretched';
export type FitVerdict = 'fills' | 'gaps' | 'crops' | 'unknown';

export interface FitReport {
  verdict: FitVerdict;
  anchor: FitAnchor;
  frameAspect: number;
  imageAspect: number;
  gapEachSide: number;
  gapTopBottom: number;
  headline: string;
  detail: string;
  /** Ratio the image must be at least, to never leave a gap. */
  requiredAspect: number | null;
  /** A concrete size to supply. */
  suggested: [number, number] | null;
  /** Fraction of the image's width that is visible at the tightest frame. */
  safeCentreFraction: number | null;
  /** Smallest and largest the frame ever gets, across the widths measured. */
  frameWidthRange: [number, number] | null;
  frameHeightRange: [number, number] | null;
  sweep: SweepPoint[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function detectAnchor(m: FitMeasurement): FitAnchor {
  if (m.objectFit === 'cover') return 'cover';
  if (m.objectFit === 'contain') return 'contain';

  // Prefer what was declared. Geometry cannot distinguish an image anchored by
  // height that happens to fill from one that is stretched, and the difference
  // decides whether the advice is about ratio or not.
  const w = (m.inlineWidth ?? '').trim();
  const h = (m.inlineHeight ?? '').trim();
  if (h && h !== 'auto' && (w === 'auto' || !w)) return 'height';
  if (w && w !== 'auto' && (h === 'auto' || !h)) return 'width';

  const [rw, rh] = m.rendered;
  const [fw, fh] = m.frame;
  const heightMatches = Math.abs(rh - fh) <= 2;
  const widthMatches = Math.abs(rw - fw) <= 2;
  if (heightMatches && widthMatches) return 'stretched';
  if (heightMatches) return 'height';
  if (widthMatches) return 'width';
  return 'contain';
}

export function reportFit(m: FitMeasurement, sweep: SweepPoint[] = []): FitReport {
  const [iw, ih] = m.intrinsic;
  const [rw, rh] = m.rendered;
  const [fw, fh] = m.frame;

  const blank: FitReport = {
    verdict: 'unknown', anchor: 'contain', frameAspect: 0, imageAspect: 0,
    gapEachSide: 0, gapTopBottom: 0, requiredAspect: null, suggested: null,
    safeCentreFraction: null, frameWidthRange: null, frameHeightRange: null, sweep,
    headline: 'Could not measure this image in the page.',
    detail: 'It may not be visible at the current width.',
  };
  if (!iw || !ih || !fw || !fh) return blank;

  const frameAspect = r2(fw / fh);
  const imageAspect = r2(iw / ih);
  const gapEachSide = Math.round((fw - rw) / 2);
  const gapTopBottom = Math.round((fh - rh) / 2);
  const anchor = detectAnchor(m);

  // Across every width measured, the widest and narrowest shapes the frame
  // takes. Without this the advice is only true at the current window size.
  const aspects = sweep.length
    ? sweep.map((p) => p.frameW / p.frameH)
    : [fw / fh];
  const widestAspect = r2(Math.max(...aspects));
  const narrowestAspect = r2(Math.min(...aspects));

  const widths = sweep.length ? sweep.map((p) => p.frameW) : [fw];
  const heights = sweep.length ? sweep.map((p) => p.frameH) : [fh];
  const frameWidthRange: [number, number] = [Math.min(...widths), Math.max(...widths)];
  const frameHeightRange: [number, number] = [Math.min(...heights), Math.max(...heights)];

  const base = {
    frameAspect, imageAspect, gapEachSide, gapTopBottom, anchor, sweep,
    frameWidthRange, frameHeightRange,
  };

  if (anchor === 'cover') {
    // Worst vertical loss across the measured widths.
    const worst = sweep.reduce((acc, p) => {
      const scale = Math.max(p.frameW / iw, p.frameH / ih);
      return Math.max(acc, Math.round(ih * scale) - p.frameH);
    }, 0);
    return {
      ...base,
      verdict: 'fills',
      requiredAspect: null,
      suggested: [Math.round(fw * 2), Math.round((fw * 2) / frameAspect)],
      safeCentreFraction: null,
      headline: 'Fills the frame at any shape — but crops top and bottom.',
      detail: worst
        ? `Because the frame keeps a fixed height while its width changes, the amount ` +
          `trimmed off the top and bottom grows with the window: up to ${worst}px at the ` +
          `widths measured. If the top of the subject matters, fitting by height instead ` +
          `keeps the full height at every width and trims only the sides.`
        : 'Any proportion fills it. Keep the subject near the middle, since the edges ' +
          'may be trimmed.',
    };
  }

  if (anchor === 'height') {
    // Height is guaranteed; only the sides are ever trimmed. So the image just
    // has to be at least as wide-shaped as the widest the frame ever gets.
    const requiredAspect = r2(widestAspect);
    const suggestedH = Math.round(fh * 2);
    const suggested: [number, number] = [Math.round(suggestedH * requiredAspect), suggestedH];
    const safeCentreFraction = r2(narrowestAspect / requiredAspect);
    const fillsEverywhere = imageAspect >= requiredAspect - 0.01;

    // Expressed as the numbers someone preparing a file actually needs: the
    // box it must cover, and the rule for any height they choose.
    const [minH, maxH] = frameHeightRange;
    const [, maxW] = frameWidthRange;
    const heightPhrase = minH === maxH
      ? `always ${maxH}px tall`
      : `between ${minH}px and ${maxH}px tall`;

    const shared =
      `Anchored by height, so the full height always shows and only the sides are ` +
      `trimmed. Across the widths measured the frame is ${heightPhrase} and reaches ` +
      `${maxW}px wide — a ratio of ${requiredAspect}:1 at its widest, against ` +
      `${narrowestAspect}:1 at its narrowest. ` +
      `For any height you choose, make the image at least that height × ${requiredAspect} ` +
      `wide and it can never leave a bar. Keep the subject inside the middle ` +
      `${Math.round(safeCentreFraction * 100)}% of the width — that is all that shows ` +
      `when the frame is at its narrowest.`;

    if (fillsEverywhere && gapEachSide <= 2) {
      return {
        ...base, verdict: 'fills', requiredAspect, suggested, safeCentreFraction,
        headline: 'Fills the frame, and its full height always shows.',
        detail: shared,
      };
    }
    return {
      ...base,
      verdict: gapEachSide > 2 ? 'gaps' : 'crops',
      requiredAspect, suggested, safeCentreFraction,
      headline: gapEachSide > 2
        ? `Leaves ${gapEachSide}px of background either side.`
        : 'Wider than its frame, so the sides are trimmed.',
      detail: shared,
    };
  }

  return {
    ...base,
    verdict: gapEachSide > 2 || gapTopBottom > 2 ? 'gaps' : 'fills',
    requiredAspect: null,
    suggested: [Math.round(fw * 2), Math.round((fw * 2) / frameAspect)],
    safeCentreFraction: null,
    headline: gapEachSide > 2 || gapTopBottom > 2
      ? 'Does not fill its frame.'
      : 'Fits its frame at this width.',
    detail: `The frame is ${frameAspect}:1 here and the image is ${imageAspect}:1.`,
  };
}

type Rewrite = (imgHtml: string) => string | null;

function rewriteImgStyle(imgHtml: string, next: string[]): string | null {
  const m = imgHtml.match(/^(<img\b)([^>]*?)(\/?>)$/is);
  if (!m) return null;
  const [, open, attrs, close] = m;
  const styleMatch = attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  const existing = styleMatch ? (styleMatch[2] ?? styleMatch[3] ?? '') : '';

  const keep = existing
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !/^(width|height|object-fit)\s*:/i.test(d));

  const style = [...next, ...keep].join(';');
  if (existing.replace(/\s/g, '') === style.replace(/\s/g, '')) return null;

  const withoutStyle = styleMatch ? attrs.replace(styleMatch[0], '') : attrs;
  return `${open}${withoutStyle.trimEnd()} style="${style}"${close}`;
}

/**
 * Fill the frame at any proportion, cropping whichever axis overflows.
 *
 * Right when the frame's shape is stable, or when nothing in the image is
 * positionally important. Wrong when the frame has a fixed height and a fluid
 * width and the subject must stay framed — see the note at the top.
 */
export const makeItCover: Rewrite = (html) =>
  rewriteImgStyle(html, ['width:100%', 'height:100%', 'object-fit:cover']);

/**
 * Anchor by height: show the whole height always, trim the sides as needed.
 *
 * The right default for a fixed-height frame, and what this site already used.
 */
export const makeItFitByHeight: Rewrite = (html) =>
  rewriteImgStyle(html, ['height:100%', 'width:auto']);
