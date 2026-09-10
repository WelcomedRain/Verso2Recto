/**
 * The code view.
 *
 * Deliberately a light read-only highlighter rather than CodeMirror for now:
 * the page template is one 58 KB string with no newlines in places, and the
 * value here is *showing you where a word lives*, not free-form editing. Code
 * editing is the escape hatch, and it comes with the styling work.
 */

import { useMemo, useRef, useEffect } from 'react';

interface Props {
  text: string;
  /** Byte offset to reveal and highlight. */
  revealAt: number | null;
  compiled: boolean;
}

interface Tok {
  cls: string;
  text: string;
}

/** Tokenize one line of HTML for display. */
function lineTokens(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /(<\/?)([a-zA-Z][\w:-]*)|([\w:-]+)(=)("[^"]*"|'[^']*')|(\/?>)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ cls: 't-text', text: line.slice(last, m.index) });
    if (m[1]) {
      out.push({ cls: 't-punct', text: m[1] });
      out.push({ cls: 't-tag', text: m[2] });
    } else if (m[3]) {
      out.push({ cls: 't-attr', text: m[3] });
      out.push({ cls: 't-punct', text: m[4] });
      out.push({ cls: 't-str', text: m[5] });
    } else if (m[6]) {
      out.push({ cls: 't-punct', text: m[6] });
    }
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ cls: 't-text', text: line.slice(last) });
  return out;
}

/** Long single-line templates are unreadable; soft-wrap them into chunks. */
const CHUNK = 160;

function toLines(text: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let offset = 0;
  for (const raw of text.split('\n')) {
    if (raw.length <= CHUNK) {
      out.push({ text: raw, offset });
      offset += raw.length + 1;
      continue;
    }
    let i = 0;
    while (i < raw.length) {
      // Break at a tag boundary when one is nearby, so a line is meaningful.
      let cut = raw.lastIndexOf('><', i + CHUNK);
      if (cut <= i) cut = Math.min(raw.length, i + CHUNK) - 1;
      const slice = raw.slice(i, cut + 1);
      out.push({ text: slice, offset: offset + i });
      i = cut + 1;
    }
    offset += raw.length + 1;
  }
  return out;
}

export function CodeView({ text, revealAt, compiled }: Props) {
  const lines = useMemo(() => toLines(text), [text]);
  const selIdx = useMemo(() => {
    if (revealAt == null) return -1;
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].offset <= revealAt) return i;
    return -1;
  }, [lines, revealAt]);

  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selIdx < 0) return;
    boxRef.current?.querySelector('.code-line.sel')?.scrollIntoView({ block: 'center' });
  }, [selIdx]);

  // Rendering 58 KB as thousands of DOM lines is slow and pointless; show a
  // window around the selection.
  const from = selIdx >= 0 ? Math.max(0, selIdx - 60) : 0;
  const to = Math.min(lines.length, from + 200);

  return (
    <div className="code-view" ref={boxRef}>
      {compiled && (
        <div className="warn">
          This file is built by your design tool, not written by hand. RectoVeritas edits it precisely
          and puts everything back exactly as it found it — but do not retype it here.
        </div>
      )}
      {lines.slice(from, to).map((l, i) => (
        <div className={`code-line ${from + i === selIdx ? 'sel' : ''}`} key={from + i}>
          <span className="gutter">{from + i + 1}</span>
          <span className="content">{lineTokens(l.text).map((t, j) => (
            <span className={t.cls} key={j} style={{ display: 'inline', whiteSpace: 'pre-wrap' }}>{t.text}</span>
          ))}</span>
        </div>
      ))}
      {to < lines.length && (
        <div className="empty" style={{ paddingTop: 10 }}>
          Showing lines {from + 1}–{to} of {lines.length}. Click a word in the page to jump.
        </div>
      )}
    </div>
  );
}
