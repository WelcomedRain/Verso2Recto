/**
 * Deployment observation.
 *
 * A pushed commit is not proof the live site updated. GitHub Pages builds
 * asynchronously and can fail after a perfectly good push, so "pushed" and
 * "live" are separate facts and the UI must not conflate them.
 *
 * Verified against the real deployment: GitHub Pages serves
 * `Access-Control-Allow-Origin: *`, so the editor can fetch the published page
 * from its own origin and compare it byte for byte with what it published.
 * That is a direct observation of the thing the user cares about — is the site
 * serving my change — rather than an inference from a build API.
 */

export type DeployState =
  | 'pending'    // pushed; the live site has not caught up yet
  | 'verified'   // the live site serves exactly what we published
  | 'stale'      // the live site responded, but with different content
  | 'unknown';   // we could not observe it; say so rather than guess

export interface DeployObservation {
  state: DeployState;
  detail: string;
  checkedAt: number;
  attempts: number;
}

export interface VerifyOptions {
  /** Public URL of the published page. */
  liveUrl: string;
  /** The exact bytes we published. */
  expected: string;
  /**
   * What to call the page being checked, e.g. "the preview". Defaults to the
   * live site. Every message this function produces goes through it, so a
   * publish aimed elsewhere cannot report back about a page it never touched.
   */
  subject?: string;
  /** Total time to keep watching before reporting `pending`. */
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  onProgress?: (o: DeployObservation) => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll the live URL until it serves the published bytes.
 *
 * Never reports `verified` on anything short of an exact match. A near-match is
 * `stale`, which is the honest answer while a build is still rolling out and
 * also the honest answer if the build failed — the two are indistinguishable
 * from out here, and pretending otherwise would be the same class of lie this
 * function exists to remove.
 */
export async function verifyDeployment(opts: VerifyOptions): Promise<DeployObservation> {
  const {
    liveUrl, expected,
    // What is being checked. A publish can target a staged copy, and saying
    // "the live site is serving your change" when the live page was never
    // touched is not a wording slip — it is the app asserting something false
    // about the one page it exists to protect.
    subject = 'the live site',
    timeoutMs = 120_000,
    intervalMs = 6_000,
    signal,
    onProgress,
    fetchImpl = fetch,
    sleepImpl = defaultSleep,
  } = opts;
  const Subject = subject.charAt(0).toUpperCase() + subject.slice(1);

  const started = Date.now();
  let attempts = 0;
  let last: DeployObservation = {
    state: 'pending', detail: `Waiting for ${subject} to rebuild.`,
    checkedAt: started, attempts: 0,
  };

  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) {
      return { ...last, state: 'unknown', detail: `Stopped before ${subject} was checked.` };
    }
    attempts++;

    try {
      // Cache-bust: a CDN edge or the browser cache would otherwise hand back
      // the pre-publish copy and we would report `stale` forever.
      const url = `${liveUrl}${liveUrl.includes('?') ? '&' : '?'}__recto=${Date.now()}`;
      const res = await fetchImpl(url, { cache: 'no-store' });

      if (!res.ok) {
        last = {
          state: 'pending', attempts, checkedAt: Date.now(),
          detail: `${Subject} answered ${res.status}.`,
        };
      } else {
        const text = await res.text();
        if (text === expected) {
          const done: DeployObservation = {
            state: 'verified', attempts, checkedAt: Date.now(),
            detail: `${Subject} is serving your change.`,
          };
          onProgress?.(done);
          return done;
        }
        last = {
          state: 'stale', attempts, checkedAt: Date.now(),
          detail: `${Subject} is still serving the previous version.`,
        };
      }
    } catch {
      // A network failure here says nothing about the push, which already
      // succeeded. Report it as unobserved, not as a failed deployment.
      last = {
        state: 'unknown', attempts, checkedAt: Date.now(),
        detail: `Could not reach ${subject} to check it.`,
      };
    }

    onProgress?.(last);
    await sleepImpl(intervalMs);
  }

  return {
    ...last,
    state: last.state === 'verified' ? 'verified' : 'pending',
    detail: last.state === 'unknown'
      ? `Could not reach ${subject}. The push itself succeeded.`
      : `${Subject} has not picked up the change yet. It usually takes a minute.`,
  };
}

/** Human wording for a deployment state. Never claims more than was observed. */
export function deployLabel(o: DeployObservation | null, lastPush: number | null): string {
  if (!o) return lastPush ? 'Pushed to GitHub' : 'Working copy matches the live site';
  switch (o.state) {
    case 'verified': return 'Live site is serving your change';
    case 'stale': return 'Pushed — live site has not caught up yet';
    case 'pending': return 'Pushed — waiting on the live site';
    case 'unknown': return 'Pushed — could not check the live site';
  }
}

/** Derive the public URL from a CNAME file, falling back to Pages defaults. */
export function liveUrlFor(
  cnameFile: string | undefined,
  owner: string,
  repo: string,
  path: string,
): string {
  const host = cnameFile?.trim().split('\n')[0]?.trim();
  const dir = path.includes('/') ? `/${path.slice(0, path.lastIndexOf('/'))}` : '';
  if (host) return `https://${host}${dir}/`;
  return `https://${owner.toLowerCase()}.github.io/${repo}${dir}/`;
}
