import { useState } from 'react';
import type { StoredSource } from '../core/db';
import type { PendingChange, Step } from '../core/publish';
import type { Destination, DestinationId } from '../core/destination';
import type { SyncState } from './store';
import type { DeployObservation } from '../core/deploy';

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
              RectoVeritas keeps a complete copy on this device so you can work with no connection,
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

/* -------------------------------- Sync -------------------------------- */

/**
 * Shown only when GitHub has moved AND there is unpublished work.
 *
 * There is deliberately no "merge" here. The page is one compiled file whose
 * byte offsets shift wholesale on every export, so a three-way merge would be
 * guesswork dressed up as a feature. Two honest choices beat one dishonest one.
 */
export function SyncDialog({
  sync, onKeepLocal, onUseGitHub, onClose, busy,
}: {
  sync: SyncState;
  onKeepLocal: () => void;
  onUseGitHub: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  if (sync.kind === 'idle' || sync.kind === 'checking') return null;

  if (sync.kind === 'decision') {
    return (
      <Backdrop onClose={onClose} width={560}>
        <div className="stack">
          <div>
            <h2>GitHub has changed, and so have you</h2>
            <p style={{ marginTop: 6 }}>
              The page on GitHub is not the one your working copy came from, and you have{' '}
              {sync.dirty} unpublished change{sync.dirty === 1 ? '' : 's'}. Nothing has been
              touched yet.
            </p>
          </div>

          <table className="proptable">
            <tbody>
              <tr><td className="k">Yours</td><td className="mono" style={{ fontSize: 11 }}>{sync.localSha.slice(0, 10)} · {sync.dirty} edit{sync.dirty === 1 ? '' : 's'}</td></tr>
              <tr><td className="k">GitHub</td><td className="mono" style={{ fontSize: 11 }}>{sync.remoteSha.slice(0, 10)}</td></tr>
            </tbody>
          </table>

          <div className="banner-err">
            Taking GitHub&rsquo;s version replaces the page your edits were made against, so
            those edits can no longer be applied. Your current working copy is preserved and
            stays retrievable, but it will not be published.
          </div>

          <div className="actions">
            <button className="btn btn-primary" onClick={onKeepLocal} disabled={busy}>
              Keep my edits
            </button>
            <button className="btn" onClick={onUseGitHub} disabled={busy}>
              {busy ? 'Fetching…' : 'Take GitHub\u2019s version'}
            </button>
          </div>
        </div>
      </Backdrop>
    );
  }

  const body =
    sync.kind === 'up-to-date' ? 'Your working copy is based on the current version on GitHub.'
    : sync.kind === 'updated' ? (sync.displaced
        ? 'Updated from GitHub. Your previous working copy was preserved.'
        : 'Updated from GitHub. You had no unpublished changes.')
    : sync.message;

  return (
    <Backdrop onClose={onClose} width={460}>
      <div className="stack">
        <h2>{sync.kind === 'error' ? 'Could not check GitHub' : 'Up to date'}</h2>
        {sync.kind === 'error' ? <div className="banner-err">{body}</div> : <p>{body}</p>}
        <div className="actions">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Backdrop>
  );
}

/* ------------------------------ Publish ------------------------------ */

export function PublishDialog({
  phase, changes, steps, outcome, error, online, deploy,
  destinations, dest, onDest, everPublishedLive, onPublish, onClose,
}: {
  phase: 'review' | 'running' | 'done';
  changes: PendingChange[];
  steps: Step[];
  outcome: 'pushed' | 'queued' | 'failed' | null;
  error: string | null;
  online: boolean;
  deploy: DeployObservation | null;
  destinations: Record<DestinationId, Destination> | null;
  dest: DestinationId;
  onDest: (d: DestinationId) => void;
  everPublishedLive: boolean;
  onPublish: () => void;
  onClose: () => void;
}) {
  const target = destinations?.[dest] ?? null;
  return (
    <Backdrop onClose={phase === 'running' ? () => {} : onClose} width={560}>
      {phase === 'review' && (
        <div className="stack">
          <div>
            <h2>Publish your changes</h2>
            <p style={{ marginTop: 6 }}>
              {changes.length} change{changes.length === 1 ? '' : 's'}
              {target ? <> will go to <b>{target.url}</b></> : ' will be published'}.
            </p>
          </div>

          {/* Chosen here, at the moment of publishing, because this is the only
              screen where the difference between the two has consequences. */}
          {destinations && (
            <div className="dest">
              {(['preview', 'live'] as DestinationId[]).map((id) => (
                <button
                  key={id}
                  className={`dest-opt ${dest === id ? 'on' : ''}`}
                  onClick={() => onDest(id)}
                >
                  <span className="dest-name">
                    {destinations[id].label}
                    {id === 'preview' && !everPublishedLive && <em> · suggested</em>}
                  </span>
                  <span className="dest-url">{destinations[id].url}</span>
                  <span className="dest-why">
                    {id === 'preview'
                      ? 'A copy nobody is linked to, hidden from search. Your changes stay queued afterwards, so you can look and then publish for real.'
                      : 'The real site, visible to everyone. Publishing here clears your queue.'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!everPublishedLive && dest === 'live' && (
            <div className="banner-err">
              Nothing has ever been published from this editor, so the publish path
              itself is untested. If something is wrong with it, the homepage is a
              costly place to find out. Preview first is the cheaper order.
            </div>
          )}

          {/* Said before the button is pressed, so it has to be the truth about
              what the button will do — this is where the expectation is set. */}
          {!online && (
            <div className="banner-err">
              You are offline, so nothing can be sent. RectoVeritas will still write and
              check the whole page, which tells you it would publish cleanly — then your
              changes stay here, waiting, until you publish again with a connection.
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
          <h2>{phase === 'running' ? 'Publishing' : outcome === 'failed' ? 'Nothing was published' : outcome === 'queued' ? 'Checked — not sent' : 'Published'}</h2>

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
            <div className="stack" style={{ gap: 8 }}>
              {/* The push and the deployment are separate facts. Saying the site
                  is live before observing it is the same lie as claiming a save
                  that never happened. */}
              <div className={`step ${deploy?.state === 'verified' ? 'done' : 'active'}`}>
                <span className="mark" />
                <span className="txt">
                  {deploy?.state === 'verified'
                    ? `${target && !target.isLive ? 'The preview' : 'The live site'} is serving your change`
                    : deploy?.state === 'unknown' ? 'Could not check the page'
                    : 'Checking the page…'}
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
                {deploy?.detail ?? 'The commit is on GitHub. Watching for the rebuild to appear.'}
              </p>
            </div>
          )}
          {phase === 'done' && outcome === 'queued' && (
            <p>
              Everything is written and checked, so it would publish cleanly — but
              nothing has been sent, because there is no connection. Your changes are
              still waiting. Press Publish again once you are back online.
            </p>
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
