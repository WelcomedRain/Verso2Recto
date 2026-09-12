/**
 * Where a publish lands.
 *
 * The editor can write the page to one of two places in the same repository:
 * the live path it was opened from, or a `preview/` folder beside it. One
 * repository, one branch, one history — a staged copy is a second file, not a
 * second site, so there is nothing to drift and nothing to promote but the
 * bytes themselves.
 *
 * The distinction that matters is `isLive`. Publishing to preview leaves the
 * live page exactly as it was, which means the queued edits are still
 * outstanding and must stay queued. Treating the two the same would tell the
 * user their work had shipped when the site had not changed — the failure this
 * whole editor is built to refuse.
 */

export type DestinationId = 'preview' | 'live';

export interface Destination {
  id: DestinationId;
  /** Path within the repository this publish writes. */
  path: string;
  /** Where that file will be served once Pages rebuilds. */
  url: string;
  /** For the button and the status bar. */
  label: string;
  /**
   * True only for the real site. Drives whether a successful publish clears
   * the queue and adopts the published text as the new baseline.
   */
  isLive: boolean;
  /** Whether the published copy must ask search engines to ignore it. */
  noindex: boolean;
}

/**
 * The staged copy sits in a `preview` folder next to the live page rather than
 * at the root, so a page served from a subdirectory stages within its own
 * subdirectory and the served URL is always the live one plus `preview/`.
 */
export function previewPathFor(livePath: string): string {
  const cut = livePath.lastIndexOf('/');
  const dir = cut === -1 ? '' : livePath.slice(0, cut + 1);
  const file = cut === -1 ? livePath : livePath.slice(cut + 1);
  return `${dir}preview/${file}`;
}

export function destinationsFor(livePath: string, liveUrl: string): Record<DestinationId, Destination> {
  const base = liveUrl.endsWith('/') ? liveUrl : `${liveUrl}/`;
  return {
    preview: {
      id: 'preview',
      path: previewPathFor(livePath),
      url: `${base}preview/`,
      label: 'Preview',
      isLive: false,
      noindex: true,
    },
    live: {
      id: 'live',
      path: livePath,
      url: base,
      label: 'Live site',
      isLive: true,
      noindex: false,
    },
  };
}

/**
 * Ask search engines to ignore the staged copy.
 *
 * A preview published to a public repository is a public page. Without this it
 * is a second, complete copy of the site competing with the real one in search
 * results. The existing canonical tag already points at the live URL, which
 * says "the real one is over there"; this says "and do not list this one at
 * all", which is the part that actually keeps it out.
 *
 * Injected into the first <head>, which is the one the publish gate inspects,
 * so the gate validates the exact bytes that ship rather than a near miss.
 */
const ROBOTS_TAG = '<meta name="robots" content="noindex, nofollow">';

export function withNoindex(fileText: string): string {
  const m = /<head\b[^>]*>/i.exec(fileText);
  // No head at all is not this function's problem to report — the gate refuses
  // such a file a moment later, with a message written for it.
  if (!m) return fileText;

  const at = m.index + m[0].length;
  const close = fileText.indexOf('</head>', at);
  const head = close === -1 ? fileText.slice(at) : fileText.slice(at, close);
  // Idempotent, and scoped to the head: a `robots` string elsewhere in a two
  // megabyte payload must not be mistaken for this tag.
  if (/<meta[^>]+name=["']robots["']/i.test(head)) return fileText;

  return `${fileText.slice(0, at)}\n  ${ROBOTS_TAG}${fileText.slice(at)}`;
}
