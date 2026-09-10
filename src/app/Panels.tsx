import { useMemo } from 'react';
import type { AssetInfo, Bundle } from '../core/bundle';
import { assetDataUrl } from '../core/bundle';
import type { ElementNode, StringEntry, TemplateIndex } from '../core/htmlIndex';
import type { PendingChange } from '../core/publish';
import type { EditTarget } from '../core/targets';
import type { StyleDecl, ThemeToken } from '../core/css';
import { StyleSections } from './StylePanel';

const fmtBytes = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/* ------------------------------- Words ------------------------------- */

export function WordsPanel({
  index, valueOf, onEdit, onFocus, changes, selectedId,
}: {
  index: TemplateIndex;
  valueOf: (s: StringEntry) => string;
  onEdit: (id: string, v: string) => void;
  onFocus: (s: StringEntry) => void;
  changes: Map<string, PendingChange>;
  selectedId: string | null;
}) {
  return (
    <div className="panel">
      <div className="label">Every word on this page — {index.strings.length} in all</div>
      {index.strings.map((s) => (
        <div className="field" key={s.id}>
          <div className="field-head">
            <span className="label">{s.label}</span>
            <span className="tag">{s.tag}</span>
          </div>
          <textarea
            className={`input ${changes.has(s.id) ? 'edited' : ''}`}
            rows={2}
            value={valueOf(s)}
            disabled={s.computed}
            title={s.computed ? 'The page fills this in when it loads, so there is nothing here to change.' : undefined}
            onFocus={() => onFocus(s)}
            onChange={(e) => onEdit(s.id, e.target.value)}
            style={selectedId === s.id ? { borderColor: 'var(--color-accent)' } : undefined}
          />
          {s.computed && (
            <div className="label" style={{ textTransform: 'none', letterSpacing: 0 }}>
              The page fills this in when it loads — editing it here would not stick.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Pictures ----------------------------- */

export function PicturesPanel({
  assets, bundle, selectedUuid, onSelect,
}: {
  assets: AssetInfo[];
  bundle: Bundle;
  selectedUuid: string | null;
  onSelect: (uuid: string) => void;
}) {
  const images = useMemo(() => assets.filter((a) => a.kind === 'image'), [assets]);
  return (
    <div className="panel">
      <div className="label">{images.length} pictures in this page</div>
      {images.map((a) => (
        <button
          key={a.uuid}
          className={`pic-row ${selectedUuid === a.uuid ? 'on' : ''}`}
          onClick={() => onSelect(a.uuid)}
        >
          <img
            src={assetDataUrl(bundle.manifest[a.uuid])}
            alt=""
            style={a.mime === 'image/png' ? { objectFit: 'contain' } : undefined}
          />
          <div style={{ minWidth: 0 }}>
            <div className="name">{a.uuid.slice(0, 8)}…</div>
            <div className="meta">{a.mime.replace('image/', '').toUpperCase()} · {fmtBytes(a.bytes)}</div>
            <div className="use">used by {a.usedBy.join(', ') || 'nothing'} · in bundle</div>
          </div>
        </button>
      ))}
      <div className="empty">
        These pictures live inside the page file rather than as separate files.
        Replacing them is coming next; for now you can see what is there and where it is used.
      </div>
    </div>
  );
}

/* ----------------------------- Selection ----------------------------- */

export function SelectionPanel({
  entry, index, change, valueOf, onEdit, onUndo, onShowCode,
  element, decls, hoverDecls, targetsById, tokens, changes, hoverHeld, onHoldHover,
}: {
  entry: StringEntry | null;
  index: TemplateIndex;
  change: PendingChange | undefined;
  valueOf: ((s: StringEntry) => string) & ((t: EditTarget) => string);
  onEdit: (id: string, v: string) => void;
  onUndo: (id: string) => void;
  onShowCode: () => void;
  element: ElementNode | null;
  decls: StyleDecl[];
  hoverDecls: StyleDecl[];
  targetsById: Map<string, EditTarget>;
  tokens: ThemeToken[];
  changes: Map<string, PendingChange>;
  hoverHeld: boolean;
  onHoldHover: (hold: boolean) => void;
}) {
  const styling = (
    <StyleSections
      compact
      element={element}
      decls={decls}
      hoverDecls={hoverDecls}
      valueOf={valueOf}
      onEdit={onEdit}
      changes={changes}
      targetsById={targetsById}
      tokens={tokens}
      hoverHeld={hoverHeld}
      onHoldHover={onHoldHover}
    />
  );

  if (!entry) {
    // No editable words, but the element may still be worth styling — which is
    // the usual case for a button or an image.
    return (
      <div className="panel">
        {element ? (
          <>
            <div className="label">{element.tag} · no words of its own</div>
            {styling}
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={onShowCode}>
              Show me the code
            </button>
          </>
        ) : (
          <div className="empty">Click anything in the page on the left.</div>
        )}
      </div>
    );
  }
  const el = index.byId.get(entry.elementId);
  return (
    <div className="panel">
      <table className="proptable">
        <tbody>
          <tr><td className="k">Kind</td><td>{entry.kind === 'attr' ? 'Share / SEO tag' : entry.label}</td></tr>
          <tr><td className="k">Where</td><td className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{el?.path ?? '—'}</td></tr>
          <tr><td className="k">File</td><td className="mono" style={{ fontSize: 11 }}>{change?.file ?? 'index.html'}</td></tr>
          <tr><td className="k">Found at</td><td className="mono" style={{ fontSize: 11 }}>byte {entry.start.toLocaleString()}</td></tr>
          <tr>
            <td className="k">Status</td>
            <td>{entry.computed ? 'Filled in when the page loads' : change ? 'Edited, not published yet' : 'Matches the live site'}</td>
          </tr>
        </tbody>
      </table>

      <textarea
        className={`input ${change ? 'edited' : ''}`}
        rows={4}
        value={valueOf(entry)}
        disabled={entry.computed}
        onChange={(e) => onEdit(entry.id, e.target.value)}
      />

      {change && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="label">Live on the site right now</div>
          <div className="was">{change.liveValue}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onShowCode}>Show me the code</button>
        {change && <button className="btn" onClick={() => onUndo(entry.id)}>Undo</button>}
      </div>

      <div style={{ borderTop: '2px solid var(--color-divider)', paddingTop: 12 }} className="stack">
        {styling}
      </div>
    </div>
  );
}
