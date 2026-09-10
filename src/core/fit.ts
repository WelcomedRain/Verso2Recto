/**
 * How an image sits in the frame the page gives it.
 *
 * The question this answers is "what size should the replacement be?", which
 * has no answer from the image alone. The frame is laid out by the cascade and
 * is usually fluid, so the only honest source is a measurement of the rendered
 * page — and the useful advice is about the *ratio*, not a pixel size.
 */

export interface FitMeasurement {
  elementId: string;
  /** The image's own pixel dimensions. */
  intrinsic: [number, number];
  /** How large it is drawn. */
  rendered: [number, number];
  /** The box it is drawn inside. */
  frame: [number, number];
  objectFit: string;
  frameOverflow: string;
}

export type FitVerdict = 'fills' | 'gaps' | 'crops' | 'unknown';

export interface FitReport {
  verdict: FitVerdict;
  /** Ratio the frame wants, at the width it is currently laid out. */
  frameAspect: number;
  imageAspect: number;
  /** Empty space either side, or hidden overflow, in CSS pixels. */
  gapEachSide: number;
  gapTopBottom: number;
  headline: string;
  detail: string;
  /** A concrete size to supply, at 2x for sharpness. */
  suggested: [number, number] | null;
  /** True when the frame crops, so a mismatched ratio is harmless. */
  cropsAutomatically: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function reportFit(m: FitMeasurement): FitReport {
  const [iw, ih] = m.intrinsic;
  const [rw, rh] = m.rendered;
  const [fw, fh] = m.frame;

  if (!iw || !ih || !fw || !fh) {
    return {
      verdict: 'unknown', frameAspect: 0, imageAspect: 0,
      gapEachSide: 0, gapTopBottom: 0, suggested: null, cropsAutomatically: false,
      headline: 'Could not measure this image in the page.',
      detail: 'It may not be visible at the current width.',
    };
  }

  const frameAspect = round(fw / fh);
  const imageAspect = round(iw / ih);
  const gapEachSide = Math.round((fw - rw) / 2);
  const gapTopBottom = Math.round((fh - rh) / 2);

  // `cover` scales to fill and crops the excess, so the supplied ratio stops
  // mattering — which is the whole point of recommending it.
  const cropsAutomatically = m.objectFit === 'cover';

  // Twice the frame's current width keeps it sharp on a high-density display,
  // and gives room for the frame growing at other window widths.
  const suggested: [number, number] = [
    Math.round(fw * 2),
    Math.round(fw * 2 / frameAspect),
  ];

  if (cropsAutomatically) {
    return {
      verdict: 'fills', frameAspect, imageAspect, gapEachSide, gapTopBottom,
      suggested, cropsAutomatically,
      headline: 'Fills the frame at any shape.',
      detail:
        'The frame is set to crop, so a replacement of any proportion fills it — ' +
        'only keep the subject near the middle, since the edges may be trimmed.',
    };
  }

  if (gapEachSide > 2 || gapTopBottom > 2) {
    const dim = gapEachSide > gapTopBottom ? 'either side' : 'above and below';
    const gap = Math.max(gapEachSide, gapTopBottom);
    return {
      verdict: 'gaps', frameAspect, imageAspect, gapEachSide, gapTopBottom,
      suggested, cropsAutomatically,
      headline: `Leaves ${gap}px of background ${dim}.`,
      detail:
        `The frame wants ${frameAspect}:1 at this window width and the image is ` +
        `${imageAspect}:1. Because the frame is fluid, no single ratio fills it at ` +
        'every width — setting the frame to crop is the reliable fix.',
    };
  }

  if (rw > fw + 2 || rh > fh + 2) {
    return {
      verdict: 'crops', frameAspect, imageAspect, gapEachSide, gapTopBottom,
      suggested, cropsAutomatically,
      headline: 'Wider than its frame, so the sides are trimmed.',
      detail:
        `The frame is ${frameAspect}:1 here and the image is ${imageAspect}:1. ` +
        'It fills, but keep anything important away from the left and right edges.',
    };
  }

  return {
    verdict: 'fills', frameAspect, imageAspect, gapEachSide, gapTopBottom,
    suggested, cropsAutomatically,
    headline: 'Fits its frame at this width.',
    detail:
      'The frame is fluid, so this can change at other window widths. Setting the ' +
      'frame to crop makes it fill at every width regardless of the image ratio.',
  };
}

/**
 * Rewrite an `<img>` tag so it fills its frame at any window width.
 *
 * `object-fit: cover` is the standard answer to "make this image fill a box of
 * unknown proportion": the browser scales it to cover and trims the excess, so
 * the supplied ratio stops mattering. Returns null when the tag is already set
 * up that way, so the UI can avoid offering a change that does nothing.
 */
export function makeItCover(imgHtml: string): string | null {
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

  const next = ['width:100%', 'height:100%', 'object-fit:cover', ...keep].join(';');
  if (existing.replace(/\s/g, '') === next.replace(/\s/g, '')) return null;

  const withoutStyle = styleMatch ? attrs.replace(styleMatch[0], '') : attrs;
  return `${open}${withoutStyle.trimEnd()} style="${next}"${close}`;
}
