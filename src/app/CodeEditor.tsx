/**
 * Editing an element's own markup.
 *
 * Deliberately scoped to one element rather than opening the whole file. The
 * page is a single 58 KB line of compiled output; a free-roaming editor over
 * that would invite exactly the accidental damage the rest of this app works to
 * prevent, and the display lines shown in Code view are derived for reading
 * rather than a real document to type into.
 *
 * An element is the right unit: it is what you selected, it has exact
 * boundaries, its replacement can be validated before anything is written, and
 * a mistake is confined to it.
 */

import { useEffect, useState } from 'react';
import { validateFragment } from '../core/targets';

interface Props {
  /** The element's exact source, open tag through closing tag. */
  source: string;
  /** Label for the thing being edited, e.g. `a` or `section`. */
  tag: string;
  /** Pending edit for this element, if one is queued. */
  pending: string | null;
  onApply: (next: string) => void;
  onRevert: () => void;
}

export function ElementCodeEditor({ source, tag, pending, onApply, onRevert }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(pending ?? source);

  // Selecting a different element must not leave the previous one's markup in
  // the box, which would then be applied to the wrong element on Apply.
  useEffect(() => {
    setDraft(pending ?? source);
    setOpen(pending != null);
  }, [source, pending]);

  const problem = validateFragment(draft);
  const changed = draft !== (pending ?? source);
  const canApply = !problem && draft !== source;

  if (!open) {
    return (
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        Edit this code
      </button>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="label">The code for this &lt;{tag}&gt;</span>
        {pending && <span className="tag" style={{ color: 'var(--color-accent-700)' }}>edited</span>}
      </div>

      <textarea
        className={`input mono ${pending ? 'edited' : ''}`}
        style={{ fontSize: 12, lineHeight: 1.6, minHeight: 150 }}
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />

      {problem && <div className="banner-err">{problem}</div>}

      <div className="empty" style={{ marginTop: -2 }}>
        Replaces this element and nothing else. Any changes you have queued
        inside it are folded into what you write here.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={!canApply} onClick={() => onApply(draft)}>
          {changed ? 'Apply' : 'Applied'}
        </button>
        <button
          className="btn"
          onClick={() => { setDraft(source); onRevert(); }}
          disabled={!pending && draft === source}
        >
          Back to original
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
}
