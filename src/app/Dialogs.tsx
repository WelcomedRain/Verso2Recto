import { useState } from 'react';
import type { StoredSource } from '../core/db';
import type { PendingChange, Step } from '../core/publish';

function Backdrop({ children, onClose, width }: { children: React.ReactNode; onClose: () => void; width: number }) {
  return (
    <div className="backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="dialog" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const ago = (t: number | null) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/* ------------------------------ Source ------------------------------- */

export function SourceDialog({
  source, lastPush, onRefetch, onDisconnect, onClose,
}: {
  source: StoredSource;
  lastPush: number | null;
  onRefetch: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  return (
    <Backdrop onClose={onClose} width={620}>
      <div className="stack">
        <div>
          <h2>Where your words live</h2>
          <p style={{ marginTop: 6 }}>
            You edit a copy held on this device. Publishing sends it to GitHub, and GitHub
            rebuilds the live site.
          </p>
        </div>

        <div className="cols3">
          <div>
            <span className="label">You edit this</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16 }}>Working copy</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>
              on this device · fetched {ago(source.lastFetched)}
            </span>
          </div>
          <div>
            <span className="label">Publishing goes here</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16 }}>GitHub</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>
              {source.owner}/{source.repo} · {source.branch}
            </span>
          </div>
          <div>
            <span className="label">Everyone sees this</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16 }}>Live site</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>
              rebuilt {ago(lastPush)}
            </span>
          </div>
        </div>

        <div className="actions">
          <button className="btn btn-primary" onClick={onRefetch}>Fetch the latest from GitHub</button>
          <button className="btn" onClick={onDisconnect}>Connect a different site</button>
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </Backdrop>
  );
}

/* ------------------------------ Connect ------------------------------ */

export function ConnectDialog({
  onConnect, error, busy,
}: {
  onConnect: (v: { repo: string; branch: string; token: string }) => void;
  error: string | null;
  busy: boolean;
}) {
  const [repo, setRepo] = useState('WelcomedRain/Anthea-Solve');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');

  return (
    <div className="backdrop">
      <div className="dialog" style={{ maxWidth: 620 }}>
        <div className="stack">
          <div>
            <h2>Connect your site</h2>
            <p style={{ marginTop: 6 }}>
              Recto keeps a complete copy on this device so you can work with no connection,
              and publishes when you ask it to.
            </p>
          </div>

          {error && <div className="banner-err">{error}</div>}

          <div className="numbered">
            <span className="n">01</span>
            <div className="stack" style={{ gap: 7, flex: 1 }}>
              <div style={{ fontSize: 15, fontFamily: 'var(--font-heading)', fontWeight: 800 }}>Which repository</div>
              <p style={{ fontSize: 13 }}>The GitHub repository that holds your site.</p>
              <input className="input mono" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" />
            </div>
          </div>

          <div className="numbered">
            <span className="n">02</span>
            <div className="stack" style={{ gap: 7, flex: 1 }}>
              <div style={{ fontSize: 15, fontFamily: 'var(--font-heading)', fontWeight: 800 }}>Which branch</div>
              <p style={{ fontSize: 13 }}>The branch GitHub Pages builds from.</p>
              <input className="input mono" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </div>
          </div>

          <div className="numbered">
            <span className="n">03</span>
            <div className="stack" style={{ gap: 7, flex: 1 }}>
              <div style={{ fontSize: 15, fontFamily: 'var(--font-heading)', fontWeight: 800 }}>A GitHub token</div>
              <p style={{ fontSize: 13 }}>
                A fine-grained personal access token with <b>Contents: read and write</b> on this
                repository — nothing else. It is stored on this device only and sent to GitHub alone.
                Make one at github.com → Settings → Developer settings → Personal access tokens →
                Fine-grained tokens.
              </p>
              <input
                className="input mono"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="github_pat_…"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="actions">
            <button
              className="btn btn-primary"
              disabled={busy || !repo.trim() || !token.trim()}
              onClick={() => onConnect({ repo, branch, token })}
            >
              {busy ? 'Fetching…' : 'Open my site'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Publish ------------------------------ */

export function PublishDialog({
  phase, changes, steps, outcome, error, online, onPublish, onClose,
}: {
  phase: 'review' | 'running' | 'done';
  changes: PendingChange[];
  steps: Step[];
  outcome: 'pushed' | 'queued' | 'failed' | null;
  error: string | null;
  online: boolean;
  onPublish: () => void;
  onClose: () => void;
}) {
  return (
    <Backdrop onClose={phase === 'running' ? () => {} : onClose} width={560}>
      {phase === 'review' && (
        <div className="stack">
          <div>
            <h2>Publish your changes</h2>
            <p style={{ marginTop: 6 }}>
              {changes.length} change{changes.length === 1 ? '' : 's'} will go to the live site.
            </p>
          </div>

          {!online && (
            <div className="banner-err">
              You are offline. Recto will do everything it can now and send it to GitHub by
              itself as soon as you are back online.
            </div>
          )}

          <div className="stack" style={{ gap: 10 }}>
            {changes.map((c) => (
              <div className="change" key={c.targetId}>
                <div className="head">
                  <span className="label">{c.label}</span>
                  <span className="mono" style={{ fontSize: 11, marginLeft: 'auto', color: 'var(--color-neutral-700)' }}>{c.file}</span>
                </div>
                <div className="from">{c.liveValue || '(empty)'}</div>
                <div className="to">{c.nextValue || '(empty)'}</div>
              </div>
            ))}
          </div>

          <div className="actions">
            <button className="btn btn-primary" onClick={onPublish}>Publish</button>
            <button className="btn btn-ghost" onClick={onClose}>Not yet</button>
          </div>
        </div>
      )}

      {phase !== 'review' && (
        <div className="stack">
          <h2>{phase === 'running' ? 'Publishing' : outcome === 'failed' ? 'Nothing was published' : outcome === 'queued' ? 'Saved and queued' : 'Published'}</h2>

          <div>
            {steps.map((s) => (
              <div className={`step ${s.state}`} key={s.id}>
                <span className="mark" />
                <span className="txt">{s.label}</span>
                <span className="note">{s.note}</span>
              </div>
            ))}
          </div>

          {phase === 'done' && outcome === 'failed' && (
            <div className="banner-err">
              {error}
              <div style={{ marginTop: 6 }}>
                Your edits are safe and still queued. Nothing reached the live site.
              </div>
            </div>
          )}

          {phase === 'done' && outcome === 'pushed' && (
            <p>GitHub is rebuilding the site now. It usually appears within a minute.</p>
          )}
          {phase === 'done' && outcome === 'queued' && (
            <p>Everything is written and checked. It will publish itself when you are back online.</p>
          )}

          {phase === 'done' && (
            <div className="actions">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      )}
    </Backdrop>
  );
}
