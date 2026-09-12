/**
 * A minimal GitHub REST client — just enough to clone a small static site and
 * push a commit back.
 *
 * Deliberately not isomorphic-git: this repo is one branch with one author, and
 * a browser-side git implementation would need a CORS proxy to reach GitHub,
 * which means the site's traffic transiting a third party. The REST API needs
 * neither.
 *
 * The token is a fine-grained PAT with Contents: read+write on the target repo
 * only. It is held in IndexedDB and never leaves the browser except as an
 * Authorization header to api.github.com.
 */

const API = 'https://api.github.com';

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

export interface RepoFile {
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
}

export class GitHubError extends Error {
  constructor(message: string, readonly status: number, readonly hint?: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

/**
 * GitHub's own words, when the body carries them.
 *
 * The response body was already being captured and then dropped before it
 * reached anyone, leaving only our reading of the status code. A 403 has more
 * than one cause, so the guess can be confidently wrong — quoting the API
 * alongside it costs nothing and settles which cause it was.
 */
function githubSays(body: string): string | null {
  try {
    const m = (JSON.parse(body) as { message?: unknown }).message;
    return typeof m === 'string' && m.trim() ? m.trim() : null;
  } catch {
    return null;
  }
}

function withSaid(text: string, body: string): string {
  const said = githubSays(body);
  return said ? `${text} GitHub said: “${said}”.` : text;
}

export function friendly(status: number, body: string): string {
  switch (status) {
    case 401:
      return withSaid('GitHub rejected the token. It may have expired, or been revoked.', body);
    case 403:
      if (body.includes('rate limit')) {
        return 'GitHub rate limit reached. Wait a few minutes and try again.';
      }
      // Says what is certain — it cannot write — then both things that cause
      // it. The second is the one people miss: the "Public repositories"
      // preset is read-only and cannot be granted write at all, so it reads
      // perfectly and refuses every push.
      return withSaid(
        'The token cannot write to this repository. Check two things on it: that '
        + 'Repository access lists this repository (the “Public repositories” preset '
        + 'is read-only and cannot be given write), and that Contents is set to '
        + 'Read and write.',
        body,
      );
    case 404:
      return withSaid(
        'Not found. Check the repository name, the branch, and that the token can see this repository.',
        body,
      );
    case 409:
      return 'The branch moved while publishing. Fetch the latest and try again.';
    case 422:
      return 'GitHub refused the change as invalid.';
    default:
      return `GitHub returned ${status}.`;
  }
}

export class GitHub {
  constructor(private token: string) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new GitHubError(friendly(res.status, body), res.status, body.slice(0, 300));
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async getBranchHead(ref: RepoRef): Promise<{ commitSha: string; treeSha: string }> {
    const r = await this.call<{ object: { sha: string } }>(
      `/repos/${ref.owner}/${ref.repo}/git/ref/heads/${ref.branch}`,
    );
    const commit = await this.call<{ tree: { sha: string } }>(
      `/repos/${ref.owner}/${ref.repo}/git/commits/${r.object.sha}`,
    );
    return { commitSha: r.object.sha, treeSha: commit.tree.sha };
  }

  /** The whole tree in one request — fine for a static site of this size. */
  async listTree(ref: RepoRef, treeSha: string): Promise<RepoFile[]> {
    const r = await this.call<{
      tree: { path: string; sha: string; size?: number; type: string }[];
      truncated: boolean;
    }>(`/repos/${ref.owner}/${ref.repo}/git/trees/${treeSha}?recursive=1`);
    if (r.truncated) {
      throw new GitHubError(
        'This repository is too large to open in one pass.',
        200,
        'tree truncated',
      );
    }
    return r.tree
      .filter((t) => t.type === 'blob' || t.type === 'tree')
      .map((t) => ({
        path: t.path,
        sha: t.sha,
        size: t.size ?? 0,
        type: t.type === 'blob' ? ('file' as const) : ('dir' as const),
      }));
  }

  /** Raw bytes of a blob. Base64 is what the API gives us. */
  async getBlob(ref: RepoRef, sha: string): Promise<Uint8Array> {
    const r = await this.call<{ content: string; encoding: string }>(
      `/repos/${ref.owner}/${ref.repo}/git/blobs/${sha}`,
    );
    if (r.encoding !== 'base64') throw new GitHubError('Unexpected blob encoding.', 200);
    const bin = atob(r.content.replace(/\n/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async getBlobText(ref: RepoRef, sha: string): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.getBlob(ref, sha));
  }

  async createBlob(ref: RepoRef, content: string, encoding: 'utf-8' | 'base64'): Promise<string> {
    const r = await this.call<{ sha: string }>(
      `/repos/${ref.owner}/${ref.repo}/git/blobs`,
      { method: 'POST', body: JSON.stringify({ content, encoding }) },
    );
    return r.sha;
  }

  /**
   * Commit a set of file changes and move the branch.
   *
   * Uses the low-level git API rather than the contents API so that several
   * files land in one commit — a publish that touched index.html and og.jpg
   * must not appear as two half-states on the live site.
   */
  async commitFiles(
    ref: RepoRef,
    files: { path: string; content: string; encoding: 'utf-8' | 'base64' }[],
    message: string,
  ): Promise<{ commitSha: string }> {
    const head = await this.getBranchHead(ref);

    const tree = await Promise.all(
      files.map(async (f) => ({
        path: f.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: await this.createBlob(ref, f.content, f.encoding),
      })),
    );

    const newTree = await this.call<{ sha: string }>(
      `/repos/${ref.owner}/${ref.repo}/git/trees`,
      { method: 'POST', body: JSON.stringify({ base_tree: head.treeSha, tree }) },
    );

    const commit = await this.call<{ sha: string }>(
      `/repos/${ref.owner}/${ref.repo}/git/commits`,
      {
        method: 'POST',
        body: JSON.stringify({ message, tree: newTree.sha, parents: [head.commitSha] }),
      },
    );

    await this.call(`/repos/${ref.owner}/${ref.repo}/git/refs/heads/${ref.branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    return { commitSha: commit.sha };
  }
}

/** Accepts `owner/repo`, a full URL, or a Pages URL. */
export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/\.git$/, '');
  const url = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/i);
  if (url) return { owner: url[1], repo: url[2] };
  const bare = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (bare) return { owner: bare[1], repo: bare[2] };
  return null;
}
