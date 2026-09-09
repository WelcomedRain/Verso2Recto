/**
 * The persisted working copy.
 *
 * The premise of the app is editing offline for an unbounded period, so the
 * queue, the source, and the fetched files all have to survive a restart. Only
 * `health` is recomputed on open.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { PendingChange } from './publish';
import type { RepoRef } from './github';

export interface StoredSource extends RepoRef {
  path: string;
  lastFetched: number | null;
  siteName: string;
}

/**
 * An edit stored as a replayable patch rather than only as a finished file.
 *
 * A Claude Design export overwrites the whole bundle. Keeping the pre-edit
 * value and a content fingerprint lets us detect that an export landed and
 * offer to re-apply, without having decided yet whether this app or the
 * exporter is the source of truth.
 */
export interface StoredPatch extends PendingChange {
  id: string;
  createdAt: number;
  /** Fingerprint of the template the patch was authored against. */
  baseFingerprint: string;
}

interface Schema {
  meta: { key: string; value: unknown };
  files: { key: string; value: { path: string; text?: string; bytes?: Uint8Array; sha: string } };
  patches: { key: string; value: StoredPatch };
}

let dbp: Promise<IDBPDatabase<any>> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB('verso2recto', 1, {
      upgrade(d) {
        d.createObjectStore('meta');
        d.createObjectStore('files', { keyPath: 'path' });
        d.createObjectStore('patches', { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('meta', key) as Promise<T | undefined>;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}
export async function delMeta(key: string): Promise<void> {
  await (await db()).delete('meta', key);
}

export async function putFile(f: Schema['files']['value']): Promise<void> {
  await (await db()).put('files', f);
}
export async function getFile(path: string): Promise<Schema['files']['value'] | undefined> {
  return (await db()).get('files', path);
}
export async function allFiles(): Promise<Schema['files']['value'][]> {
  return (await db()).getAll('files');
}
export async function clearFiles(): Promise<void> {
  await (await db()).clear('files');
}

export async function putPatch(p: StoredPatch): Promise<void> {
  await (await db()).put('patches', p);
}
export async function allPatches(): Promise<StoredPatch[]> {
  return (await db()).getAll('patches');
}
export async function delPatch(id: string): Promise<void> {
  await (await db()).delete('patches', id);
}
export async function clearPatches(): Promise<void> {
  await (await db()).clear('patches');
}

/**
 * A cheap, stable fingerprint of the template.
 *
 * Not cryptographic — its only job is to notice that the bundle was replaced
 * wholesale by an export.
 */
export function fingerprint(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}-${s.length.toString(16)}`;
}

/** The PAT. Kept out of `meta` so it can be cleared on its own. */
const TOKEN_KEY = 'github-token';
export async function getToken(): Promise<string | undefined> {
  return getMeta<string>(TOKEN_KEY);
}
export async function setToken(t: string): Promise<void> {
  await setMeta(TOKEN_KEY, t);
}
export async function clearToken(): Promise<void> {
  await delMeta(TOKEN_KEY);
}
