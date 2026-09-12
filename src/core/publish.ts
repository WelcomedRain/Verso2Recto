/**
 * The publish pipeline.
 *
 * Five steps, in order, and step 4 is a hard gate: if the share tags are not
 * literal HTML inside <head>, nothing ships. That is the product's core safety
 * promise. The failure it guards against is silent — the build goes green, the
 * site looks perfect, and every link preview is dead.
 */

import { parseBundle, serializeBundle, verifyRoundTrip } from './bundle';
import { applyEdits, encodeAttr, type Edit } from './htmlIndex';
import { encodeFor, type EditTarget } from './targets';
import { GitHub, type RepoRef } from './github';
import { withNoindex, type Destination } from './destination';

export type StepId = 'written' | 'rebuilt' | 'spliced' | 'verified' | 'pushed';
export type StepState = 'waiting' | 'active' | 'done' | 'failed';

export interface Step {
  id: StepId;
  label: string;
  note: string;
  state: StepState;
}

export const STEP_LABELS: Record<StepId, string> = {
  written: 'Write your edits into the working copy',
  rebuilt: 'Rebuild the page file',
  spliced: 'Move the share tags into the head',
  verified: 'Check the share tags are really there',
  pushed: 'Send it to GitHub',
};

export interface PendingChange {
  targetId: string;
  file: string;
  label: string;
  tag: string;
  /** What kind of thing was edited: words, an inline style, a theme value. */
  kind: EditTarget['kind'];
  /**
   * Explicit range, used only by whole-element code edits.
   *
   * Every other change addresses a value that the index already holds, so it
   * resolves through the target map. An element's own markup is not a value in
   * that map — and must not be added to it, since its range contains every
   * target inside the element and would break the no-overlap guarantee the map
   * relies on. So a code edit carries its own range.
   */
  start?: number;
  end?: number;
  /** The value on the live site, captured before the first edit. */
  liveValue: string;
  nextValue: string;
}

/** Turn pending changes into byte-range edits against the template. */
export function editsFor(changes: PendingChange[], targets: Map<string, EditTarget>): Edit[] {
  return changes.map((c) => {
    if (c.kind === 'html' || c.kind === 'style-attr') {
      if (c.start == null || c.end == null) {
        throw new Error(`Cannot publish "${c.label}": its position in the page was lost.`);
      }
      if (c.kind === 'html') {
        return { start: c.start, end: c.end, replacement: encodeFor('html', c.nextValue) };
      }
      // An element with no style attribute needs one written, not a value
      // swapped — an empty range means insert.
      const inner = encodeAttr(c.nextValue);
      return {
        start: c.start,
        end: c.end,
        replacement: c.start === c.end ? ` style="${inner}"` : inner,
      };
    }
    const t = targets.get(c.targetId);
    if (!t) throw new Error(`Cannot publish "${c.label}": its position in the page was lost.`);
    return { start: t.start, end: t.end, replacement: encodeFor(t.kind, c.nextValue) };
  });
}

const HEAD_MARKER_BEGIN = 'static-head:begin';
const HEAD_MARKER_END = 'static-head:end';

export interface HeadCheck {
  ok: boolean;
  detail: string;
  /** Tags found as literal HTML inside <head>. */
  tagCount: number;
}

/**
 * Step 4, the gate.
 *
 * Deliberately dumb and literal: find `<head>`, find `</head>`, and require the
 * marker block and a plausible number of meta tags to sit strictly between
 * them. A scraper does not run JavaScript and does not repair malformed markup,
 * so neither do we. Anything clever here would be a way to talk ourselves into
 * shipping a broken page.
 */
export function verifyHeadTags(fileText: string): HeadCheck {
  const headOpen = fileText.indexOf('<head>');
  const headClose = fileText.indexOf('</head>');
  if (headOpen === -1 || headClose === -1) {
    return { ok: false, detail: 'The page has no <head> section.', tagCount: 0 };
  }
  if (headClose < headOpen) {
    return { ok: false, detail: 'The <head> section is malformed.', tagCount: 0 };
  }

  const head = fileText.slice(headOpen, headClose);
  const begin = head.indexOf(HEAD_MARKER_BEGIN);
  const end = head.indexOf(HEAD_MARKER_END);

  if (begin === -1 || end === -1) {
    const anywhere = fileText.indexOf(HEAD_MARKER_BEGIN);
    return {
      ok: false,
      tagCount: 0,
      detail: anywhere === -1
        ? 'The share tags are missing entirely. Run the splice before publishing.'
        : 'The share tags are in the page but outside <head>, where scrapers never look.',
    };
  }
  if (end < begin) {
    return { ok: false, detail: 'The share-tag block is malformed.', tagCount: 0 };
  }

  const block = head.slice(begin, end);
  const tagCount = (block.match(/<meta\s|<link\s/g) ?? []).length;
  if (tagCount < 8) {
    return {
      ok: false,
      tagCount,
      detail: `Only ${tagCount} share tags found inside <head>; expected at least 8.`,
    };
  }
  const og = (block.match(/property="og:/g) ?? []).length;
  if (og < 3) {
    return { ok: false, tagCount, detail: 'The Open Graph tags are missing from <head>.' };
  }

  return { ok: true, tagCount, detail: `${tagCount} share tags are literal HTML inside <head>.` };
}

export interface PublishInput {
  ref: RepoRef;
  token: string;
  /** The unmodified index.html as fetched from GitHub. */
  originalFile: string;
  /** Which file in the repository this publish writes, and what that means. */
  destination: Destination;
  changes: PendingChange[];
  targets: Map<string, EditTarget>;
  message: string;
  online: boolean;
}

export interface PublishResult {
  /**
   * `queued` means written, rebuilt and verified but NOT sent — there was no
   * connection. Nothing in the app retries it. The edits stay in the queue and
   * the user publishes again when they are back online, which the footer's
   * running count already reminds them to do. Do not reintroduce a promise of
   * an automatic retry without first building one.
   */
  outcome: 'pushed' | 'queued' | 'failed';
  steps: Step[];
  /**
   * Echoed back so the caller cannot reset the baseline against a publish that
   * never touched the live page. Read `destination.isLive`, never the phase.
   */
  destination: Destination;
  commitSha?: string;
  /** The rebuilt file, kept so an offline publish can be replayed later. */
  fileText?: string;
  error?: string;
}

export async function publish(
  input: PublishInput,
  onStep: (steps: Step[]) => void,
): Promise<PublishResult> {
  const steps: Step[] = (Object.keys(STEP_LABELS) as StepId[]).map((id) => ({
    id,
    label: STEP_LABELS[id],
    note: '',
    state: 'waiting',
  }));

  const set = (id: StepId, state: StepState, note: string) => {
    const s = steps.find((x) => x.id === id)!;
    s.state = state;
    s.note = note;
    onStep([...steps]);
  };
  const fail = (id: StepId, note: string): PublishResult => {
    set(id, 'failed', note);
    return { outcome: 'failed', steps, destination: input.destination, error: note };
  };

  // 1 — write
  set('written', 'active', '');
  let bundle;
  try {
    bundle = parseBundle(input.originalFile);
  } catch (e) {
    return fail('written', (e as Error).message);
  }
  const rt = verifyRoundTrip(bundle);
  if (!rt.ok) {
    return fail(
      'written',
      `${rt.detail} Refusing to write rather than risk corrupting the page.`,
    );
  }
  let nextTemplate: string;
  try {
    nextTemplate = applyEdits(bundle.template, editsFor(input.changes, input.targets));
  } catch (e) {
    return fail('written', (e as Error).message);
  }
  set('written', 'done', `${input.changes.length} change${input.changes.length === 1 ? '' : 's'} written`);

  // 2 — rebuild
  set('rebuilt', 'active', '');
  let fileText = serializeBundle(bundle, { template: nextTemplate });
  // Before the readback, so the readback covers the injection too, and before
  // the gate, so the gate judges the exact bytes that will be committed.
  if (input.destination.noindex) fileText = withNoindex(fileText);
  try {
    const check = parseBundle(fileText);
    if (check.template !== nextTemplate) {
      return fail('rebuilt', 'The rebuilt page did not read back correctly.');
    }
  } catch (e) {
    return fail('rebuilt', `The rebuilt page is not readable: ${(e as Error).message}`);
  }
  set('rebuilt', 'done', input.destination.noindex
    ? `${Math.round(fileText.length / 1024)} KB · marked noindex`
    : `${Math.round(fileText.length / 1024)} KB`);

  // 3 — splice. The block already sits in <head> in the current export, so this
  // step is a no-op unless an export moved it. Re-splicing is left to the health
  // fix, which owns the marker block; here we only report what we found.
  set('spliced', 'active', '');
  const pre = verifyHeadTags(fileText);
  set('spliced', 'done', pre.ok ? 'already in place' : 'needs repair');

  // 4 — verify. THE GATE.
  set('verified', 'active', '');
  const check = verifyHeadTags(fileText);
  if (!check.ok) {
    return fail('verified', `${check.detail} Nothing was published.`);
  }
  set('verified', 'done', check.detail);

  // 5 — push
  set('pushed', 'active', '');
  if (!input.online) {
    // Deliberately not 'done'. Nothing was sent, and a filled mark beside
    // "Pushed" says the opposite of that. The dialog used to promise the app
    // would send it later; nothing anywhere does, so the promise is gone and
    // the step reads as what it is — the one thing that did not happen.
    set('pushed', 'waiting', 'not sent — no connection');
    return { outcome: 'queued', steps, destination: input.destination, fileText };
  }
  try {
    const gh = new GitHub(input.token);
    const { commitSha } = await gh.commitFiles(
      input.ref,
      [{ path: input.destination.path, content: fileText, encoding: 'utf-8' }],
      input.message,
    );
    set('pushed', 'done', `${commitSha.slice(0, 7)} → ${input.destination.path}`);
    return { outcome: 'pushed', steps, destination: input.destination, commitSha, fileText };
  } catch (e) {
    return fail('pushed', (e as Error).message);
  }
}
