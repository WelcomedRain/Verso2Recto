/**
 * What the footer is for: answering, at a glance and without being asked,
 * the three questions that decide whether an action is safe.
 *
 *   1. What am I editing?      — a copy, always, and that never changes
 *   2. What is waiting, and where would it go if I pressed the red button?
 *   3. Can I publish right now, and if not, why not?
 *
 * Each answer has its own slot and every slot is always filled. A status line
 * that disappears when the answer is reassuring teaches you to read its absence
 * as a warning, which is exactly backwards.
 */

import { deployLabel } from '../core/deploy';
import type { DeployObservation } from '../core/deploy';

export type ConnectionTone = 'ok' | 'switched' | 'lost';

export interface StatusLine {
  /** Question 1. Never varies, because the answer never varies. */
  mode: string;
  /** Question 2. What is queued and where Publish would send it. */
  pending: string;
  /** Question 3. Absent only when connected, which needs no explanation. */
  connection: { text: string; tone: ConnectionTone } | null;
}

/** The host a publish would land on, for saying so out loud. */
export function publishTarget(liveUrl: string | null | undefined): string | null {
  if (!liveUrl) return null;
  try { return new URL(liveUrl).host; } catch { return null; }
}

export function statusLine(o: {
  dirty: number;
  networkUp: boolean;
  manualOffline: boolean;
  liveUrl?: string | null;
  deploy: DeployObservation | null;
  lastPush: number | null;
}): StatusLine {
  // Stated in the present tense and permanently, because it is permanently
  // true. It used to appear only while changes were queued, which implied the
  // opposite the rest of the time.
  const mode = 'Editing a copy on this computer';

  const host = publishTarget(o.liveUrl);
  const one = o.dirty === 1;
  const changes = `${o.dirty} change${one ? '' : 's'} waiting`;
  const pending = o.dirty > 0
    ? (host ? `${changes} · Publish sends ${one ? 'it' : 'them'} to ${host}` : changes)
    : deployLabel(o.deploy, o.lastPush);

  // The trap this separates: `online` was one flag standing for two unrelated
  // things. Flipping the header switch for a test and forgetting produced
  // "Offline" with a perfectly good connection, and nothing on screen could
  // tell you which of the two you were looking at.
  let connection: StatusLine['connection'] = null;
  if (o.manualOffline) {
    connection = { text: 'Offline — you switched this on', tone: 'switched' };
  } else if (!o.networkUp) {
    connection = { text: 'Offline — no connection, so nothing can publish', tone: 'lost' };
  }

  return { mode, pending, connection };
}
