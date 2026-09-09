import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from './store';
import { PageView } from './PageView';
import { CodeView } from './CodeView';
import { WordsPanel, PicturesPanel, SelectionPanel } from './Panels';
import { SourceDialog, ConnectDialog, PublishDialog } from './Dialogs';
import { FileText, Image as ImageIcon } from './icons';
import { publish, type Step, type PublishResult } from '../core/publish';
import * as db from '../core/db';
import type { StringEntry } from '../core/htmlIndex';

type Mode = 'page' | 'split' | 'code';
type Tab = 'words' | 'pictures' | 'selection';

export function App() {
  const ed = useEditor();
  const { state, online } = ed;

  const [mode, setMode] = useState<Mode>('page');
  const [tab, setTab] = useState<Tab>('words');
  const [showSource, setShowSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  const [pub, setPub] = useState<{
    open: boolean; phase: 'review' | 'running' | 'done';
    steps: Step[]; outcome: PublishResult['outcome'] | null; error: string | null;
  }>({ open: false, phase: 'review', steps: [], outcome: null, error: null });

  const [fileText, setFileText] = useState('');
  useEffect(() => {
    if (!state.activeFile) return setFileText('');
    void db.getFile(state.activeFile).then((f) => setFileText(f?.text ?? ''));
  }, [state.activeFile, state.bundle]);

  const selectedEntry = state.selection.stringId
    ? state.index?.stringsById.get(state.selection.stringId) ?? null
    : null;

  /** A click in the page maps to the first indexed string of that element. */
  const onSelectElement = useCallback((elementId: string, runOrdinal: number) => {
    const idx = ed.state.index;
    if (!idx) return;
    const candidates = idx.strings.filter((s) => s.elementId === elementId && s.kind === 'text');
    const hit = candidates.find((s) => s.runOrdinal === runOrdinal) ?? candidates[0];
    if (hit) {
      ed.select(hit.id, elementId);
      setTab('selection');
    } else {
      // The element has no editable words of its own — say so rather than
      // silently doing nothing, which was the prototype's central complaint.
      ed.select(null, elementId);
      setTab('selection');
    }
  }, [ed]);

  const liveEdits = useMemo(
    () => ed.changeList.flatMap((c) => {
      const e = state.index?.stringsById.get(c.stringId);
      if (!e) return [];
      return [{
        elementId: e.elementId,
        runOrdinal: e.runOrdinal ?? 0,
        kind: e.kind,
        attrName: e.attrName,
        value: c.nextValue,
      }];
    }),
    [ed.changeList, state.index],
  );

  const doPublish = async () => {
    if (!state.source || !state.index || !fileText) return;
    setPub((p) => ({ ...p, phase: 'running', steps: [], outcome: null, error: null }));
    const result = await publish(
      {
        ref: state.source,
        token: state.token ?? '',
        originalFile: fileText,
        path: state.source.path,
        changes: ed.changeList,
        index: state.index.stringsById,
        message: `Update site copy (${ed.changeList.length} change${ed.changeList.length === 1 ? '' : 's'})`,
        online,
      },
      (steps) => setPub((p) => ({ ...p, steps })),
    );
    setPub((p) => ({ ...p, phase: 'done', outcome: result.outcome, error: result.error ?? null, steps: result.steps }));
    if (result.outcome === 'pushed' && result.fileText) {
      await ed.commitPublished(result.commitSha ?? null, result.fileText);
    }
  };

  if (!state.ready) {
    return <div style={{ padding: 24 }} className="label">Opening your working copy…</div>;
  }

  if (!state.source || !state.token) {
    return (
      <ConnectDialog
        error={state.error}
        busy={busy}
        onConnect={async (v) => { setBusy(true); await ed.connect(v); setBusy(false); }}
      />
    );
  }

  const dirty = ed.changeList.length;
  const idx = state.index;

  return (
    <div className="shell">
      {/* ---------------- header ---------------- */}
      <header className="header">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">RECTO</span>
        </div>
        <span className="rule-v" />
        <button className="source-btn" onClick={() => setShowSource(true)}>
          <div className="site">{state.source.siteName}</div>
          <div className="where">local copy · {state.source.owner}/{state.source.repo}</div>
        </button>

        <div style={{ flex: 1 }} />

        <button
          className="btn btn-ghost"
          onClick={() => ed.setManualOffline((v) => !v)}
          title="Switch between online and offline for testing"
        >
          <span className={`status-square ${online ? '' : 'off'}`} />
          {online ? 'Online' : 'Offline'}
        </button>

        <button
          className="btn btn-primary"
          disabled={dirty === 0}
          onClick={() => setPub({ open: true, phase: 'review', steps: [], outcome: null, error: null })}
        >
          Publish changes
          {dirty > 0 && <span className="badge">{dirty}</span>}
        </button>
      </header>

      {/* ---------------- middle ---------------- */}
      <div className="middle">
        {/* sidebar */}
        <aside className="sidebar">
          <div>
            <div className="label sidebar-label">Offline copy of the site</div>
            {state.files.slice(0, 40).map((f) => {
              const isPage = f.path === state.activeFile;
              const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(f.path);
              return (
                <button
                  key={f.path}
                  className={`row file ${isPage ? 'active' : ''}`}
                  onClick={() => { if (isImg) { setTab('pictures'); } }}
                >
                  {isImg ? <ImageIcon /> : <FileText />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</span>
                  {isPage && dirty > 0 && <span className="dirty" />}
                </button>
              );
            })}
          </div>

          {state.health && (
            <div className="health">
              <div className="label">Checked on open</div>
              <div className="health-counts">
                <div className="health-count"><span>Words found</span><b>{state.health.stringsIndexed}</b></div>
                <div className="health-count"><span>Pictures found</span><b>{state.health.imagesFound}</b></div>
              </div>
              <div className={`card ${state.health.headTagsInHead ? 'ok' : ''}`}>
                <div className="card-title">Link previews</div>
                <div className="card-body">
                  {state.health.headTagsInHead
                    ? 'The share tags are in the right place. Link previews will work.'
                    : state.health.headDetail}
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* centre */}
        <main className="centre">
          <div className="toolbar">
            <span className="path">{state.activeFile}</span>
            <span className="note">
              compiled · {Math.round((fileText.length || 0) / 1024)} KB
            </span>
            <span className="spacer" />
            <div className="seg">
              <button className={mode === 'page' ? 'on' : ''} onClick={() => setMode('page')}>Page</button>
              <button className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')}>Page + code</button>
              <button className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>Code</button>
            </div>
          </div>

          <div className={`panes ${mode === 'split' ? 'split' : ''}`}>
            {mode !== 'code' && idx && (
              <PageView
                file={state.activeFile ?? ''}
                fileText={fileText}
                index={idx}
                onSelectElement={onSelectElement}
                selectedElementId={state.selection.elementId}
                liveEdits={liveEdits}
              />
            )}
            {mode !== 'page' && state.bundle && (
              <CodeView
                text={state.bundle.template}
                revealAt={selectedEntry?.start ?? null}
                compiled
              />
            )}
          </div>
        </main>

        {/* right */}
        <aside className="right">
          <div className="tabs">
            <button className={tab === 'words' ? 'on' : ''} onClick={() => setTab('words')}>Words</button>
            <button className={tab === 'pictures' ? 'on' : ''} onClick={() => setTab('pictures')}>Pictures</button>
            <button className={tab === 'selection' ? 'on' : ''} onClick={() => setTab('selection')}>Selection</button>
          </div>

          {tab === 'words' && idx && (
            <WordsPanel
              index={idx}
              valueOf={ed.valueOf}
              onEdit={ed.edit}
              onFocus={(s: StringEntry) => ed.select(s.id, s.elementId)}
              changes={state.changes}
              selectedId={state.selection.stringId}
            />
          )}

          {tab === 'pictures' && state.bundle && (
            <PicturesPanel
              assets={state.assets}
              bundle={state.bundle}
              selectedUuid={selectedAsset}
              onSelect={setSelectedAsset}
            />
          )}

          {tab === 'selection' && idx && (
            selectedEntry || !state.selection.elementId ? (
              <SelectionPanel
                entry={selectedEntry}
                index={idx}
                change={selectedEntry ? state.changes.get(selectedEntry.id) : undefined}
                valueOf={ed.valueOf}
                onEdit={ed.edit}
                onUndo={ed.undo}
                onShowCode={() => setMode('split')}
              />
            ) : (
              <div className="panel">
                <div className="empty">
                  That part of the page has no words of its own — it is a container holding
                  other things. Click the words themselves, or pick them from the Words list.
                </div>
              </div>
            )
          )}
        </aside>
      </div>

      {/* ---------------- footer ---------------- */}
      <footer className="footer">
        <span className={`chip ${dirty ? 'dirty' : ''}`}>
          {online
            ? dirty ? `Online · ${dirty} unpublished` : 'Online · everything published'
            : `Offline · ${dirty} change${dirty === 1 ? '' : 's'} queued`}
        </span>
        <span>
          {dirty
            ? 'Editing a copy — the live site is untouched'
            : state.lastPush ? 'Live site rebuilt a moment ago' : 'Working copy matches the live site'}
        </span>
        <span style={{ marginLeft: 'auto' }}>Installed as an app</span>
      </footer>

      {/* ---------------- dialogs ---------------- */}
      {showSource && (
        <SourceDialog
          source={state.source}
          lastPush={state.lastPush}
          onRefetch={() => { setShowSource(false); void ed.refetch(); }}
          onDisconnect={() => { setShowSource(false); void ed.disconnect(); }}
          onClose={() => setShowSource(false)}
        />
      )}

      {pub.open && (
        <PublishDialog
          phase={pub.phase}
          changes={ed.changeList}
          steps={pub.steps}
          outcome={pub.outcome}
          error={pub.error}
          online={online}
          onPublish={doPublish}
          onClose={() => setPub({ open: false, phase: 'review', steps: [], outcome: null, error: null })}
        />
      )}

      {state.error && (
        <div style={{ position: 'fixed', bottom: 46, left: 14, right: 14, zIndex: 30 }}>
          <div className="banner-err">{state.error}</div>
        </div>
      )}
    </div>
  );
}
