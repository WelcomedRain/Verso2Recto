/**
 * All editor state, in one hook.
 *
 * Small enough not to need a state library, and keeping it in one place makes
 * the "publish clears the queue" invariants checkable by reading one file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseBundle, listAssets, type Bundle, type AssetInfo } from '../core/bundle';
import { indexTemplate, type TemplateIndex, type StringEntry } from '../core/htmlIndex';
import { GitHub, parseRepoInput, type RepoRef } from '../core/github';
import { verifyHeadTags, type PendingChange } from '../core/publish';
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
  /** An export replaced the bundle since our patches were authored. */
  exportDetected: boolean;
}

export interface EditorState {
  ready: boolean;
  error: string | null;
  source: db.StoredSource | null;
  token: string | null;
  files: RepoFileEntry[];
  activeFile: string | null;
  bundle: Bundle | null;
  index: TemplateIndex | null;
  assets: AssetInfo[];
  health: HealthState | null;
  changes: Map<string, PendingChange>;
  selection: { stringId: string | null; elementId: string | null };
  online: boolean;
  lastPush: number | null;
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
    assets: [],
    health: null,
    changes: new Map(),
    selection: { stringId: null, elementId: null },
    online: navigator.onLine,
    lastPush: null,
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

        const changes = new Map<string, PendingChange>();
        for (const p of patches) changes.set(p.stringId, p);

        let bundle: Bundle | null = null;
        let index: TemplateIndex | null = null;
        let assets: AssetInfo[] = [];
        let health: HealthState | null = null;
        const activeFile = source?.path ?? null;

        if (activeFile) {
          const stored = await db.getFile(activeFile);
          if (stored?.text) {
            ({ bundle, index, assets, health } = openBundle(stored.text));
          }
        }

        setState((s) => ({
          ...s,
          ready: true,
          token: token ?? null,
          source: source ?? null,
          files: files ?? [],
          activeFile,
          bundle,
          index,
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
        await gh.whoAmI();
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

        await db.clearFiles();
        await db.putFile({ path: page.path, text, sha: page.sha });
        const source: db.StoredSource = {
          ...ref,
          path: page.path,
          lastFetched: Date.now(),
          siteName: parsed.repo,
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
          selection: { stringId: null, elementId: null },
        }));
      } catch (e) {
        patch({ error: (e as Error).message });
      }
    },
    [patch],
  );

  const refetch = useCallback(async () => {
    if (!state.source || !state.token) return;
    patch({ error: null });
    try {
      const gh = new GitHub(state.token);
      const head = await gh.getBranchHead(state.source);
      const tree = await gh.listTree(state.source, head.treeSha);
      const page = tree.find((t) => t.path === state.source!.path);
      if (!page) throw new Error('The page file is gone from the repository.');
      const text = await gh.getBlobText(state.source, page.sha);
      await db.putFile({ path: page.path, text, sha: page.sha });
      const source = { ...state.source, lastFetched: Date.now() };
      await db.setMeta('source', source);
      setState((s) => ({ ...s, source, ...openBundle(text) }));
    } catch (e) {
      patch({ error: (e as Error).message });
    }
  }, [state.source, state.token, patch]);

  /** Record an edit. The pre-edit value is captured once and kept. */
  const edit = useCallback(
    (stringId: string, nextValue: string) => {
      setState((s) => {
        const entry = s.index?.stringsById.get(stringId);
        if (!entry || !s.source) return s;
        const changes = new Map(s.changes);
        const existing = changes.get(stringId);
        const liveValue = existing?.liveValue ?? entry.value;

        if (nextValue === liveValue) {
          changes.delete(stringId);
          void db.delPatch(stringId);
        } else {
          const change: PendingChange = {
            stringId,
            file: s.source.path,
            label: entry.label,
            tag: entry.tag,
            liveValue,
            nextValue,
          };
          changes.set(stringId, change);
          void db.putPatch({
            ...change,
            id: stringId,
            createdAt: existing ? Date.now() : Date.now(),
            baseFingerprint: s.bundle ? db.fingerprint(s.bundle.template) : '',
          });
        }
        return { ...s, changes };
      });
    },
    [],
  );

  const undo = useCallback((stringId: string) => {
    setState((s) => {
      const changes = new Map(s.changes);
      changes.delete(stringId);
      void db.delPatch(stringId);
      return { ...s, changes };
    });
  }, []);

  const select = useCallback((stringId: string | null, elementId: string | null) => {
    setState((s) => ({ ...s, selection: { stringId, elementId } }));
  }, []);

  /** After a successful publish the edited values become the new baseline. */
  const commitPublished = useCallback(async (commitSha: string | null, fileText: string) => {
    await db.clearPatches();
    const now = Date.now();
    await db.setMeta('lastPush', now);
    setState((s) => {
      if (s.source) void db.putFile({ path: s.source.path, text: fileText, sha: commitSha ?? '' });
      return { ...s, changes: new Map(), lastPush: now, ...openBundle(fileText) };
    });
  }, []);

  const disconnect = useCallback(async () => {
    await db.clearPatches();
    await db.clearFiles();
    await db.delMeta('source');
    await db.clearToken();
    setState((s) => ({
      ...s,
      token: null, source: null, files: [], activeFile: null,
      bundle: null, index: null, assets: [], health: null,
      changes: new Map(), selection: { stringId: null, elementId: null },
    }));
  }, []);

  /** The values shown in the editor: pending edit if any, else the live value. */
  const valueOf = useCallback(
    (s: StringEntry) => state.changes.get(s.id)?.nextValue ?? s.value,
    [state.changes],
  );

  const changeList = useMemo(() => [...state.changes.values()], [state.changes]);

  return {
    state, online, manualOffline, setManualOffline,
    connect, refetch, edit, undo, select, commitPublished, disconnect,
    valueOf, changeList, patch,
  };
}

function openBundle(text: string): Pick<EditorState, 'bundle' | 'index' | 'assets' | 'health'> {
  const bundle = parseBundle(text);
  const index = indexTemplate(bundle.template);
  const assets = listAssets(bundle);
  const head = verifyHeadTags(text);
  return {
    bundle,
    index,
    assets,
    health: {
      headTagsInHead: head.ok,
      headDetail: head.detail,
      stringsIndexed: index.strings.length,
      imagesFound: assets.filter((a) => a.kind === 'image').length,
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
