import { useMemo } from 'react';
import type { AssetInfo, Bundle } from '../core/bundle';
import { assetDataUrl } from '../core/bundle';
import { imageSizeFromBase64, formatSize } from '../core/imageMeta';
import type { FitReport } from '../core/fit';
import { useRef, useState } from 'react';
import type { ElementNode, StringEntry, TemplateIndex } from '../core/htmlIndex';
import type { PendingChange } from '../core/publish';
import type { EditTarget } from '../core/targets';
import type { StyleDecl, ThemeToken } from '../core/css';
import { StyleSections, ValueField, type MatchedRule } from './StylePanel';
import { ElementCodeEditor } from './CodeEditor';

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
  // Page furniture and page content are different jobs, and this list used to
  // run them together in document order — which put fourteen invisible
  // Share / SEO boxes above the first word anybody can actually see. Someone
  // looking for the main heading scrolled to the top, opened the first box
  // that would open, and edited the meta description instead. The two are
  // separated now, and the words you can see come first.
  const seo = index.strings.filter((s) => s.pageInfo);
  const words = index.strings.filter((s) => !s.pageInfo);

  const field = (s: StringEntry) => (
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
  );

  return (
    <div className="panel">
      <div className="label">Words on the page — {words.length}</div>
      {words.map(field)}

      {seo.length > 0 && (
        <>
          <div className="group-head">
            <div className="label">Page information — {seo.length}</div>
            <p>
              None of these appear on the page. They are what Google shows in
              search results and what a link preview shows when someone shares
              the address.
            </p>
          </div>
          {seo.map(field)}
        </>
      )}
    </div>
  );
}

/* ------------------------------ Pictures ----------------------------- */

export function PicturesPanel({
  assets, bundle, selectedUuid, onSelect, onReplace, usedByElement,
  fit, sweeping, onCheckWidths, onSetFit, onShowCode,
  backgroundTarget, backgroundValue, backgroundEdited, tokens, onEditBackground,
}: {
  assets: AssetInfo[];
  bundle: Bundle;
  selectedUuid: string | null;
  onSelect: (uuid: string) => void;
  onReplace: (uuid: string, file: File) => Promise<{ ok: boolean; message: string }>;
  /** Element id in the page that shows this image, when there is one. */
  usedByElement: (uuid: string) => string | null;
  fit: FitReport | null;
  sweeping: boolean;
  onCheckWidths: () => void;
  onSetFit: (how: 'cover' | 'height') => void;
  onShowCode: () => void;
  backgroundTarget: EditTarget | null;
  backgroundValue: string;
  backgroundEdited: boolean;
  tokens: ThemeToken[];
  onEditBackground: (v: string) => void;
}) {
  const images = useMemo(() => assets.filter((a) => a.kind === 'image'), [assets]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Dimensions come from the header bytes, so they are the image's real size
  // rather than however the page happens to display it.
  const sizes = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of images) {
      m.set(a.uuid, formatSize(imageSizeFromBase64(bundle.manifest[a.uuid].data)));
    }
    return m;
  }, [images, bundle]);

  const pick = (uuid: string) => {
    setResult(null);
    onSelect(uuid);
    const input = fileRef.current;
    if (!input) return;
    input.onchange = async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      setBusy(uuid);
      setResult(await onReplace(uuid, file));
      setBusy(null);
    };
    input.click();
  };

  return (
    <div className="panel">
      <div className="label">{images.length} images in this page</div>
      <input ref={fileRef} type="file" accept="image/*" hidden />

      {result && (
        <div className={result.ok ? 'was' : 'banner-err'}>{result.message}</div>
      )}

      {images.map((a) => {
        const on = selectedUuid === a.uuid;
        const inPage = usedByElement(a.uuid);
        return (
          <div key={a.uuid} className={`pic-row ${on ? 'on' : ''}`} style={{ flexWrap: 'wrap' }}>
            <button
              onClick={() => onSelect(a.uuid)}
              style={{ display: 'flex', gap: 10, alignItems: 'center', flex: '1 1 auto', textAlign: 'left', minWidth: 0 }}
              title={inPage ? 'Show where this is used' : 'Not shown in the page'}
            >
              <img
                src={assetDataUrl(bundle.manifest[a.uuid])}
                alt=""
                style={a.mime === 'image/png' ? { objectFit: 'contain' } : undefined}
              />
              <span style={{ minWidth: 0 }}>
                <span className="name" style={{ display: 'block' }}>{a.uuid.slice(0, 8)}…</span>
                <span className="meta" style={{ display: 'block' }}>
                  {sizes.get(a.uuid)} · {a.mime.replace('image/', '').toUpperCase()} ·{' '}
                  {a.bytes > 1024 * 1024 ? `${(a.bytes / 1048576).toFixed(1)} MB` : `${Math.round(a.bytes / 1024)} KB`}
                </span>
                <span className="use" style={{ display: 'block' }}>
                  {inPage ? 'click to find it in the page' : 'not shown in the page'}
                </span>
              </span>
            </button>
            {on && (
              <div className="stack" style={{ gap: 8, flex: '1 1 100%' }}>
                {fit && (
                  <div className={fit.verdict === 'fills' ? 'was' : 'card'}>
                    <div className="card-title" style={{ marginBottom: 4 }}>In the page</div>
                    <div className="card-body">
                      <b>{fit.headline}</b>
                      <div style={{ marginTop: 4 }}>{fit.detail}</div>
                      {fit.suggested && (
                        <div style={{ marginTop: 6 }}>
                          Supply about{' '}
                          <span className="mono">{fit.suggested[0]} × {fit.suggested[1]}</span>
                          {fit.requiredAspect ? ` (${fit.requiredAspect}:1) or wider.` : '.'}
                        </div>
                      )}
                      {fit.sweep.length === 0 && (
                        <div style={{ marginTop: 6 }}>
                          Measured at this window width only.{' '}
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: '2px 6px' }}
                            onClick={onCheckWidths}
                            disabled={sweeping}
                          >
                            {sweeping ? 'Checking…' : 'Check every width'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {backgroundTarget && (
                  <div className="field">
                    <div className="field-head">
                      <span className="label">Behind it</span>
                      {backgroundEdited && (
                        <span className="tag" style={{ color: 'var(--color-accent-700)' }}>edited</span>
                      )}
                    </div>
                    <ValueField
                      target={backgroundTarget}
                      value={backgroundValue}
                      edited={backgroundEdited}
                      tokens={tokens}
                      onEdit={onEditBackground}
                    />
                    <div className="empty" style={{ marginTop: 2 }}>
                      What shows either side when the image is narrower than its frame.
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '5px 9px' }}
                    disabled={busy === a.uuid}
                    onClick={() => pick(a.uuid)}
                  >
                    {busy === a.uuid ? 'Replacing…' : 'Replace'}
                  </button>
                  {fit && fit.anchor !== 'height' && (
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: '5px 9px' }}
                      onClick={() => onSetFit('height')}
                      title="Show the whole height at every width and trim only the sides"
                    >
                      Fit by height
                    </button>
                  )}
                  {fit && fit.anchor !== 'cover' && (
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: '5px 9px' }}
                      onClick={() => onSetFit('cover')}
                      title="Fill at any proportion, trimming whichever side overflows"
                    >
                      Fill and crop
                    </button>
                  )}
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: '5px 9px' }}
                    onClick={onShowCode}
                  >
                    Show me the code
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="empty">
        These live inside the page file rather than as separate files, so replacing one
        rewrites the file itself — no markup changes and no reference to update. The
        exporter keeps no original filename, which is why each shows its id.
      </div>
    </div>
  );
}

/* ----------------------------- Selection ----------------------------- */

export function SelectionPanel({
  entry, index, change, valueOf, onEdit, onUndo, onShowCode,
  element, decls, hoverDecls, rules, targetsById, tokens, changes, hoverHeld, onHoldHover,
  onScopeToElement,
  elementSource, elementPending, onEditHtml, onRevertHtml,
}: {
  entry: StringEntry | null;
  index: TemplateIndex;
  change: PendingChange | undefined;
  valueOf: ((s: StringEntry) => string) & ((t: EditTarget) => string);
  onEdit: (id: string, v: string) => void;
  onScopeToElement: (elementId: string, prop: string, value: string) => void;
  onUndo: (id: string) => void;
  onShowCode: () => void;
  element: ElementNode | null;
  decls: StyleDecl[];
  hoverDecls: StyleDecl[];
  rules: MatchedRule[];
  targetsById: Map<string, EditTarget>;
  tokens: ThemeToken[];
  changes: Map<string, PendingChange>;
  hoverHeld: boolean;
  onHoldHover: (hold: boolean) => void;
  elementSource: string | null;
  elementPending: string | null;
  onEditHtml: (html: string) => void;
  onRevertHtml: () => void;
}) {
  const codeEditor = element && elementSource != null ? (
    <div style={{ borderTop: '2px solid var(--color-divider)', paddingTop: 12 }} className="stack">
      <ElementCodeEditor
        source={elementSource}
        tag={element.tag}
        pending={elementPending}
        onApply={onEditHtml}
        onRevert={onRevertHtml}
      />
    </div>
  ) : null;

  const styling = (
    <StyleSections
      compact
      element={element}
      decls={decls}
      hoverDecls={hoverDecls}
      rules={rules}
      valueOf={valueOf}
      onEdit={onEdit}
      onScopeToElement={onScopeToElement}
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
            {codeEditor}
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

      {codeEditor}
    </div>
  );
}
