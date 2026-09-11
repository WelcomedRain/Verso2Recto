/**
 * Whether a queued change is actually visible in the rendered page.
 *
 * The editor's job is to let someone change something and look at the result.
 * The failure mode that matters is not a change that fails to publish — the
 * publish pipeline verifies itself — it is a change that is queued perfectly,
 * will publish correctly, and shows nothing in the preview. Silence reads as
 * "that did nothing", so the honest answer is to say which changes are not
 * being shown and where to go and look instead.
 *
 * Three of these were found by hand in one evening against 144 passing tests,
 * which is why the answer here is mostly *reported by the page* rather than
 * inferred from the kind of change. The page knows whether it found the
 * element and whether the element renders; this file only knows what was
 * intended.
 */

import type { TargetKind } from '../core/targets';

/**
 * What the page said when it was asked to apply a change.
 *
 * - `shown`   applied, and the node it applied to is drawn at this width
 * - `hidden`  applied, but nothing on screen reflects it
 * - `missing` could not be applied — the element or text run is not there
 * - `state`   applied, and visible only while the page is held in some state
 */
export type AckResult = 'shown' | 'hidden' | 'missing' | 'state';

export interface PreviewAck {
  result: AckResult;
  /** The page's own words for why, when it is not simply shown. */
  why?: string;
}

export type PreviewState =
  /** Visible in the page on the left, right now. */
  | 'showing'
  /** Sent, and the page has not answered yet. Transient, by a frame or two. */
  | 'waiting'
  /** Rendered, but only while you hold the page in a state it does not sit in. */
  | 'hold'
  /** The preview cannot show it. `howToSee` says where to look instead. */
  | 'not-shown';

export interface PreviewNote {
  id: string;
  label: string;
  state: PreviewState;
  /** Why it is not simply showing. Empty when it is. */
  why: string;
  /** What to do to see it. Empty when there is nothing to do. */
  howToSee: string;
}

const OK: Pick<PreviewNote, 'state' | 'why' | 'howToSee'> = {
  state: 'showing', why: '', howToSee: '',
};

/**
 * Kinds the bridge deliberately never pushes.
 *
 * `style-hover` is consumed by the Claude Design runtime while it renders — it
 * wires its own handlers and the attribute does not survive into the DOM, so
 * there is no attribute left to write to. Measured: zero in the DOM against 293
 * elements carrying `data-recto-id`.
 */
const NEVER_PUSHED: Partial<Record<TargetKind, { why: string; howToSee: string }>> = {
  'css-hover': {
    why: 'The page consumed its hover styling when it rendered, so there is nothing '
      + 'left in the page to change.',
    howToSee: 'Turn on "Hold hover" in the Style panel — that applies the edited value '
      + 'directly, which is the only faithful way to see it here.',
  },
};

export function noteFor(
  change: { targetId: string; label: string; kind: TargetKind },
  ack: PreviewAck | undefined,
): PreviewNote {
  const base = { id: change.targetId, label: change.label };

  const never = NEVER_PUSHED[change.kind];
  if (never) return { ...base, state: 'hold', ...never };

  if (!ack) return { ...base, state: 'waiting', why: '', howToSee: '' };

  if (ack.result === 'shown') return { ...base, ...OK };

  if (ack.result === 'state') {
    // Visible, but not while you are looking at the panel that changed it.
    return {
      ...base,
      state: 'hold',
      why: ack.why || 'It only shows while the element is in a particular state.',
      howToSee: 'Put the page into that state to see it — hovering the element in the '
        + 'preview will do it.',
    };
  }

  if (ack.result === 'hidden') {
    return {
      ...base,
      state: 'not-shown',
      why: ack.why || 'The change was applied, but nothing on screen reflects it.',
      howToSee: 'It will still publish. Use Code to see it in the page source.',
    };
  }

  return {
    ...base,
    state: 'not-shown',
    why: ack.why || 'The page has nothing matching this change.',
    howToSee: 'It will still publish, but check it in Code before you do.',
  };
}

export interface PreviewSummary {
  /** Changes the page is showing right now. */
  showing: number;
  /** Changes that need the page held in a state to be seen. */
  held: number;
  /** Changes the preview cannot show at all. */
  unseen: number;
  notes: PreviewNote[];
  /** One sentence for a status block, or '' when everything is on screen. */
  headline: string;
}

export function summarise(notes: PreviewNote[]): PreviewSummary {
  const held = notes.filter((n) => n.state === 'hold');
  const unseen = notes.filter((n) => n.state === 'not-shown');
  const showing = notes.filter((n) => n.state === 'showing').length;

  let headline = '';
  if (unseen.length) {
    headline = unseen.length === 1
      ? '1 change is not visible in the page here.'
      : `${unseen.length} changes are not visible in the page here.`;
  } else if (held.length) {
    headline = held.length === 1
      ? '1 change only shows while the page is held in that state.'
      : `${held.length} changes only show while the page is held in that state.`;
  }

  return {
    showing,
    held: held.length,
    unseen: unseen.length,
    notes: [...unseen, ...held],
    headline,
  };
}
