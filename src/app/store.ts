/**
 * All editor state, in one hook.
 *
 * Small enough not to need a state library, and keeping it in one place makes
 * the "publish clears the queue" invariants checkable by reading one file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseBundle, listAssets, type Bundle, type AssetInfo } from '../core/bundle';
import { indexTemplate, type TemplateIndex, type StringEntry } from '../core/htmlIndex';
import { buildTargets, validate, type EditTarget, type TargetSet } from '../core/targets';
import { outerRange } from '../core/htmlIndex';
import { GitHub, parseRepoInput, type RepoRef } from '../core/github';
import { verifyHeadTags, type PendingChange } from '../core/publish';
import { liveUrlFor, type DeployObservation } from '../core/deploy';
import * as db from '../core/db';

export type Mode = 'page' | 'split' | 'code';
export type Tab = 'words' | 'pictures' | 'selection';

export interface RepoFileEntry {
  path: string;
  size: number;
  sha: string;
}

export interface HealthState {
  headTagsInHead: boolean;
  headDetail: string;
  stringsIndexed: number;
  imagesFound: number;
  /**
   * Queued edits that no longer point at anything in the current page.
   *
   * This is what an export looks like from in here: a Claude Design re-export
   * replaces the whole bundle, so byte ranges authored against the old one stop
   * resolving. Rather than publish a guess or silently drop the work, we count
   * them and say so.
   */
  orphanedChanges: number;
  /** The bundle changed since the queued edits were authored. */
  exportDetected: boolean;
}

/**
 * What a refresh against GitHub found.
 *
 * `decision` is the important one: the working copy has unpublished edits AND
 * GitHub has moved. Replacing the file underneath those edits would strand
 * every one of them against byte offsets that no longer exist, so nothing is
 * applied until the user chooses.
 */
export type SyncState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'updated'; displaced: boolean }
  | { kind: 'decision'; remoteSha: string; localSha: string; dirty: number }
  | { kind: 'error'; message: string };

export interface EditorState {
  ready: boolean;
  error: string | null;
  source: db.StoredSource | null;
  token: string | null;
  files: RepoFileEntry[];
  activeFile: string | null;
  bundle: Bundle | null;
  index: TemplateIndex | null;
  targets: TargetSet | null;
  assets: AssetInfo[];
  health: HealthState | null;
  changes: Map<string, PendingChange>;
  selection: { targetId: string | null; elementId: string | null };
  online: boolean;
  lastPush: number | null;
  sync: SyncState;
  deploy: DeployObservation | null;
}

const PAGE_FILE_RE = /\.html?$/i;

export function useEditor() {
  const [state, setState] = useState<EditorState>({
    ready: false,
    error: null,
    source: null,
    token: null,
    files: [],
    activeFile: null,
    bundle: null,
    index: null,
    targets: null,
    assets: [],
    health: null,
    changes: new Map(),
    selection: { targetId: null, elementId: null },
    online: navigator.onLine,
    lastPush: null,
    sync: { kind: 'idle' },
    deploy: null,
  });

  const patch = useCallback((p: Partial<EditorState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  // Real connectivity, with a manual override kept for testing.
  const [manualOffline, setManualOffline] = useState(false);
  useEffect(() => {
    const on = () => patch({ online: true });
    const off = () => patch({ online: false });
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [patch]);
  const online = state.online && !manualOffline;

  /** Restore the working copy. The queue must survive a restart. */
  useEffect(() => {
    (async () => {
      try {
        const [token, source, files, patches, lastPush] = await Promise.all([
          db.getToken(),
          db.getMeta<db.StoredSource>('source'),
          db.getMeta<RepoFileEntry[]>('files'),
          db.allPatches(),
          db.getMeta<number>('lastPush'),
        ]);

        // Drop records written by an older schema rather than letting an
        // unkeyed patch inflate the badge and never publish.
        // Backfill for workspaces saved before the live URL was recorded. The
        // github.io form redirects to any custom domain and fetch follows it,
        // so this is correct even for a site on its own domain.
        const restored = source && !source.liveUrl
          ? { ...source, liveUrl: liveUrlFor(undefined, source.owner, source.repo, source.path) }
          : source;
        if (source && !source.liveUrl && restored) await db.setMeta('source', restored);

        const changes = new Map<string, PendingChange>();
        for (const p of patches) {
          if (!p.targetId) { void db.delPatch((p as { id: string }).id); continue; }
          changes.set(p.targetId, p);
        }

        let bundle: Bundle | null = null;
        let index: TemplateIndex | null = null;
        let targets: TargetSet | null = null;
        let assets: AssetInfo[] = [];
        let health: HealthState | null = null;
        const activeFile = source?.path ?? null;

        if (activeFile) {
          const stored = await db.getFile(activeFile);
          if (stored?.text) {
            ({ bundle, index, targets, assets, health } = openBundle(stored.text));
            if (health && targets && bundle) {
              health = reconcile(health, changes, targets, bundle.template);
            }
          }
        }

        setState((s) => ({
          ...s,
          ready: true,
          token: token ?? null,
          source: restored ?? null,
          files: files ?? [],
          activeFile,
          bundle,
          index,
          targets,
          assets,
          health,
          changes,
          lastPush: lastPush ?? null,
        }));
      } catch (e) {
        setState((s) => ({ ...s, ready: true, error: (e as Error).message }));
      }
    })();
  }, []);

  const connect = useCallback(
    async (input: { repo: string; branch: string; token: string }) => {
      patch({ error: null });
      const parsed = parseRepoInput(input.repo);
      if (!parsed) {
        patch({ error: 'That does not look like a GitHub repository. Try "owner/name".' });
        return;
      }
      const ref: RepoRef = { ...parsed, branch: input.branch || 'main' };
      try {
        const gh = new GitHub(input.token);
        // Fetching the branch head is the validity check. Calling /user first
        // would be a nicer greeting but reaches outside the token's repository
        // scope, so a correctly-minted single-repo token could fail here before
        // ever touching the site it is allowed to edit.
        const head = await gh.getBranchHead(ref);
        const tree = await gh.listTree(ref, head.treeSha);

        const files = tree
          .filter((t) => t.type === 'file')
          .map((t) => ({ path: t.path, size: t.size, sha: t.sha }));

        const page = files.find((f) => f.path === 'index.html')
          ?? files.find((f) => PAGE_FILE_RE.test(f.path));
        if (!page) {
          patch({ error: 'No HTML page found in that repository.' });
          return;
        }

        const text = await gh.getBlobText(ref, page.sha);
        const opened = openBundle(text);

        // A CNAME in the repository is how GitHub Pages learns the custom
        // domain, so it is also the most reliable statement of where the
        // published page will be served from.
        const cnameEntry = files.find((f) => f.path === 'CNAME');
        const cname = cnameEntry
          ? await gh.getBlobText(ref, cnameEntry.sha).catch(() => undefined)
          : undefined;

        await db.clearFiles();
        await db.putFile({ path: page.path, text, sha: page.sha });
        const source: db.StoredSource = {
          ...ref,
          path: page.path,
          lastFetched: Date.now(),
          siteName: parsed.repo,
          liveUrl: liveUrlFor(cname, ref.owner, ref.repo, page.path),
        };
        await db.setToken(input.token);
        await db.setMeta('source', source);
        await db.setMeta('files', files);

        setState((s) => ({
          ...s,
          error: null,
          token: input.token,
          source,
          files,
          activeFile: page.path,
          ...opened,
          selection: { targetId: null, elementId: null },
        }));
      } catch (e) {
        patch({ error: (e as Error).message });
      }
    },
    [patch],
  );

  /**
   * Check GitHub without touching the working copy.
   *
   * Deliberately split from applying the result. The previous implementation
   * fetched and overwrote in one step, which silently stranded pending edits
   * whenever the remote had moved — the exact "never overwrite a changed
   * working copy without an explicit reviewed choice" failure.
   */
  const checkRemote = useCallback(async (): Promise<void> => {
    if (!state.source || !state.token) return;
    if (!online) {
      patch({ sync: { kind: 'error', message: 'You are offline, so GitHub cannot be checked.' } });
      return;
    }
    patch({ sync: { kind: 'checking' }, error: null });
    try {
      const gh = new GitHub(state.token);
      const head = await gh.getBranchHead(state.source);
      const tree = await gh.listTree(state.source, head.treeSha);
      const page = tree.find((t) => t.path === state.source!.path);
      if (!page) throw new Error('The page file is gone from the repository.');

      const stored = await db.getFile(state.source.path);
      const localSha = stored?.sha ?? '';
      const dirty = state.changes.size;

      if (page.sha === localSha) {
        patch({ sync: { kind: 'up-to-date' } });
        return;
      }
      if (dirty > 0) {
        // Remote moved and there is unpublished work. Stop and ask.
        patch({ sync: { kind: 'decision', remoteSha: page.sha, localSha, dirty } });
        return;
      }
      await applyRemote(page.sha);
      patch({ sync: { kind: 'updated', displaced: false } });
    } catch (e) {
      patch({ sync: { kind: 'error', message: (e as Error).message } });
    }
  }, [state.source, state.token, state.changes, online, patch]);

  /**
   * Replace the working copy with GitHub's version.
   *
   * The displaced text is preserved first — the working copy being thrown away
   * is the only copy of that work, and losing it silently is the thing this
   * whole path exists to prevent.
   */
  const applyRemote = useCallback(async (expectSha?: string) => {
    if (!state.source || !state.token) return;
    const gh = new GitHub(state.token);
    const head = await gh.getBranchHead(state.source);
    const tree = await gh.listTree(state.source, head.treeSha);
    const page = tree.find((t) => t.path === state.source!.path);
    if (!page) throw new Error('The page file is gone from the repository.');
    if (expectSha && page.sha !== expectSha) {
      throw new Error('GitHub moved again while you were deciding. Check once more.');
    }

    const previous = await db.getFile(state.source.path);
    let displaced = false;
    if (previous?.text) {
      await db.putFile({
        path: `__displaced/${Date.now()}/${state.source.path}`,
        text: previous.text,
        sha: previous.sha,
      });
      displaced = true;
    }

    const text = await gh.getBlobText(state.source, page.sha);
    await db.putFile({ path: page.path, text, sha: page.sha });
    const source = { ...state.source, lastFetched: Date.now() };
    await db.setMeta('source', source);

    setState((s) => {
      const opened = openBundle(text);
      const health = opened.health && opened.targets
        ? reconcile(opened.health, s.changes, opened.targets, opened.bundle!.template)
        : opened.health;
      return { ...s, source, ...opened, health, sync: { kind: 'updated', displaced } };
    });
  }, [state.source, state.token]);

  /** Keep the local working copy. Never schedules a forced remote overwrite. */
  const keepLocal = useCallback(() => {
    patch({ sync: { kind: 'idle' } });
  }, [patch]);

  const dismissSync = useCallback(() => patch({ sync: { kind: 'idle' } }), [patch]);

  /** Record an edit. The pre-edit value is captured once and kept. */
  const edit = useCallback(
    (targetId: string, nextValue: string) => {
      setState((s) => {
        const target = s.targets?.byId.get(targetId);
        if (!target || !s.source) return s;

        const problem = validate(target.kind, nextValue);
        if (problem) return { ...s, error: problem };

        const changes = new Map(s.changes);
        const existing = changes.get(targetId);
        const liveValue = existing?.liveValue ?? target.current;

        if (nextValue === liveValue) {
          changes.delete(targetId);
          void db.delPatch(targetId);
        } else {
          const change: PendingChange = {
            targetId,
            file: s.source.path,
            label: target.label,
            tag: target.tag,
            kind: target.kind,
            liveValue,
            nextValue,
          };
          changes.set(targetId, change);
          void db.putPatch({
            ...change,
            id: targetId,
            createdAt: Date.now(),
            baseFingerprint: s.bundle ? db.fingerprint(s.bundle.template) : '',
          });
        }
        return { ...s, error: null, changes };
      });
    },
    [],
  );

  /**
   * Replace one element's entire markup.
   *
   * Not routed through `edit`, because this target does not exist until it is
   * created: element ranges are not in the target map, which holds values
   * rather than whole elements.
   *
   * The subtlety is overlap. Any queued edit inside this element addresses
   * bytes that the new markup replaces, so publishing both would either throw
   * on overlapping patches or apply them in a nonsensical order. Those edits
   * are therefore dropped — the markup the user just wrote is the more recent
   * and more specific statement of intent.
   */
  const editElementHtml = useCallback((elementId: string, nextHtml: string) => {
    setState((s) => {
      const el = s.index?.byId.get(elementId);
      if (!el || !s.source || !s.bundle) return s;

      const problem = validate('html', nextHtml);
      if (problem) return { ...s, error: problem };

      const { start, end } = outerRange(el);
      const original = s.bundle.template.slice(start, end);
      const id = `html:${elementId}`;
      const changes = new Map(s.changes);

      // Supersede anything queued inside the range being replaced.
      let superseded = 0;
      for (const [cid, c] of changes) {
        if (cid === id) continue;
        const t = s.targets?.byId.get(c.targetId);
        if (t && t.start >= start && t.end <= end) {
          changes.delete(cid);
          void db.delPatch(cid);
          superseded++;
        }
      }

      if (nextHtml === original) {
        changes.delete(id);
        void db.delPatch(id);
      } else {
        const change: PendingChange = {
          targetId: id,
          file: s.source.path,
          label: `${el.tag} · code`,
          tag: 'code',
          kind: 'html',
          liveValue: original,
          nextValue: nextHtml,
          start,
          end,
        };
        changes.set(id, change);
        void db.putPatch({
          ...change,
          id,
          createdAt: Date.now(),
          baseFingerprint: db.fingerprint(s.bundle.template),
        });
      }

      return {
        ...s,
        error: superseded
          ? `${superseded} earlier change${superseded === 1 ? '' : 's'} inside this element ` +
            'were replaced by the code you wrote.'
          : null,
        changes,
      };
    });
  }, []);

  const undo = useCallback((targetId: string) => {
    setState((s) => {
      const changes = new Map(s.changes);
      changes.delete(targetId);
      void db.delPatch(targetId);
      return { ...s, changes };
    });
  }, []);

  const select = useCallback((targetId: string | null, elementId: string | null) => {
    setState((s) => ({ ...s, selection: { targetId, elementId } }));
  }, []);

  /** After a successful publish the edited values become the new baseline. */
  const commitPublished = useCallback(async (commitSha: string | null, fileText: string) => {
    await db.clearPatches();
    const now = Date.now();
    await db.setMeta('lastPush', now);
    setState((s) => {
      if (s.source) void db.putFile({ path: s.source.path, text: fileText, sha: commitSha ?? '' });
      return { ...s, changes: new Map(), lastPush: now, deploy: null, ...openBundle(fileText) };
    });
  }, []);

  /** Forget queued edits that no longer point at anything in the page. */
  const dropOrphans = useCallback(() => {
    setState((s) => {
      if (!s.targets) return s;
      const changes = new Map(s.changes);
      for (const [id] of changes) {
        if (!s.targets.byId.has(id)) { changes.delete(id); void db.delPatch(id); }
      }
      const health = s.health ? { ...s.health, orphanedChanges: 0, exportDetected: false } : null;
      return { ...s, changes, health };
    });
  }, []);

  const setDeploy = useCallback((deploy: DeployObservation | null) => {
    setState((s) => ({ ...s, deploy }));
  }, []);

  const disconnect = useCallback(async () => {
    await db.clearPatches();
    await db.clearFiles();
    await db.delMeta('source');
    await db.clearToken();
    setState((s) => ({
      ...s,
      token: null, source: null, files: [], activeFile: null,
      bundle: null, index: null, targets: null, assets: [], health: null,
      sync: { kind: 'idle' }, deploy: null,
      changes: new Map(), selection: { targetId: null, elementId: null },
    }));
  }, []);

  /** The values shown in the editor: pending edit if any, else the live value. */
  const valueOf = useCallback(
    (s: StringEntry | EditTarget) =>
      state.changes.get(s.id)?.nextValue ?? ('value' in s ? s.value : s.current),
    [state.changes],
  );

  const changeList = useMemo(() => [...state.changes.values()], [state.changes]);

  return {
    state, online, manualOffline, setManualOffline,
    connect, checkRemote, applyRemote, keepLocal, dismissSync, editElementHtml,
    edit, undo, select, commitPublished, disconnect, dropOrphans, setDeploy,
    valueOf, changeList, patch,
  };
}

/**
 * Compare the queued edits against the page as it now stands.
 *
 * Called on open and after a fetch — the two moments when the bundle can have
 * been replaced underneath us.
 */
function reconcile(
  health: HealthState,
  changes: Map<string, PendingChange>,
  targets: TargetSet,
  template: string,
): HealthState {
  const fp = db.fingerprint(template);
  let orphaned = 0;
  let stale = false;
  for (const c of changes.values()) {
    // A code edit carries its own range and is deliberately absent from the
    // target map, so its absence is not evidence of anything.
    if (c.kind !== 'html' && !targets.byId.has(c.targetId)) orphaned++;
    const patch = c as Partial<db.StoredPatch>;
    if (patch.baseFingerprint && patch.baseFingerprint !== fp) stale = true;
  }
  return { ...health, orphanedChanges: orphaned, exportDetected: stale && orphaned > 0 };
}

function openBundle(
  text: string,
): Pick<EditorState, 'bundle' | 'index' | 'targets' | 'assets' | 'health'> {
  const bundle = parseBundle(text);
  const index = indexTemplate(bundle.template);
  const targets = buildTargets(bundle.template, index);
  const assets = listAssets(bundle);
  const head = verifyHeadTags(text);
  return {
    bundle,
    index,
    targets,
    assets,
    health: {
      headTagsInHead: head.ok,
      headDetail: head.detail,
      stringsIndexed: index.strings.length,
      imagesFound: assets.filter((a) => a.kind === 'image').length,
      orphanedChanges: 0,
      exportDetected: false,
    },
  };
}

/** Kept out of the hook so the preview can be rebuilt without re-rendering. */
export function useStableRef<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}
