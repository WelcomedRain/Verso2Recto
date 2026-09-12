import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { destinationsFor, previewPathFor, withNoindex } from './destination';
import { verifyHeadTags } from './publish';
import { parseBundle } from './bundle';

const REAL = 'G:/Anthea-Solve/index.html';

describe('previewPathFor', () => {
  it('stages a root page in a preview folder', () => {
    expect(previewPathFor('index.html')).toBe('preview/index.html');
  });

  it('stages a nested page inside its own folder, not at the root', () => {
    // Otherwise the staged copy would be served from somewhere the live page
    // is not, and its relative links would resolve differently.
    expect(previewPathFor('site/index.html')).toBe('site/preview/index.html');
  });
});

describe('destinationsFor', () => {
  const d = destinationsFor('index.html', 'https://antheasolve.com/');

  it('sends live to the path the page was opened from', () => {
    expect(d.live.path).toBe('index.html');
    expect(d.live.url).toBe('https://antheasolve.com/');
  });

  it('serves the preview from the live URL plus preview/', () => {
    expect(d.preview.url).toBe('https://antheasolve.com/preview/');
  });

  /**
   * The one that protects the queue. A preview publish leaves the live page
   * untouched, so the edits are still outstanding; only `isLive` may clear
   * them. If these two are ever equal the editor will tell someone their work
   * shipped when the site did not change.
   */
  it('marks only the live destination as live', () => {
    expect(d.live.isLive).toBe(true);
    expect(d.preview.isLive).toBe(false);
  });

  it('keeps the staged copy out of search results, and the live one in', () => {
    expect(d.preview.noindex).toBe(true);
    expect(d.live.noindex).toBe(false);
  });

  it('never writes the two destinations to the same path', () => {
    expect(d.preview.path).not.toBe(d.live.path);
  });

  it('tolerates a live URL with no trailing slash', () => {
    const x = destinationsFor('index.html', 'https://antheasolve.com');
    expect(x.live.url).toBe('https://antheasolve.com/');
    expect(x.preview.url).toBe('https://antheasolve.com/preview/');
  });

  it('handles a project-pages URL with a repo subdirectory', () => {
    const x = destinationsFor('index.html', 'https://welcomedrain.github.io/Anthea-Solve/');
    expect(x.preview.url).toBe('https://welcomedrain.github.io/Anthea-Solve/preview/');
  });
});

describe('withNoindex', () => {
  const page = (head: string) => `<!DOCTYPE html><html><head>${head}</head><body>x</body></html>`;

  it('puts the robots tag inside the head', () => {
    const out = withNoindex(page('<title>x</title>'));
    const inHead = out.slice(out.indexOf('<head>'), out.indexOf('</head>'));
    expect(inHead).toContain('name="robots"');
    expect(inHead).toContain('noindex');
  });

  it('is idempotent, so republishing does not stack tags', () => {
    const once = withNoindex(page('<title>x</title>'));
    expect(withNoindex(once)).toBe(once);
  });

  it('ignores the word robots elsewhere in the payload', () => {
    // The compiled bundle is two megabytes of embedded content; a match out
    // there must not be mistaken for the tag we are looking for.
    const f = page('<title>x</title>') + '<script>var name="robots";</script>';
    expect(withNoindex(f)).toContain('name="robots" content="noindex');
  });

  it('survives a head tag carrying attributes', () => {
    const out = withNoindex('<html><head lang="en"><title>x</title></head></html>');
    expect(out).toContain('<head lang="en">');
    expect(out.slice(0, out.indexOf('</head>'))).toContain('noindex');
  });

  it('leaves a file with no head alone for the gate to reject', () => {
    const f = '<html><body>no head here</body></html>';
    expect(withNoindex(f)).toBe(f);
  });
});

/**
 * The staged copy has to clear the same bar as the real one. Injecting a tag
 * into <head> is exactly the kind of edit that could push the share-tag block
 * out of the region the gate inspects, and the gate is the product's core
 * promise — so this is checked against the real export, not a fixture.
 */
describe.skipIf(!existsSync(REAL))('a staged copy of the real site', () => {
  const file = () => readFileSync(REAL, 'utf8');

  it('still passes the publish gate after the robots tag is injected', () => {
    const before = verifyHeadTags(file());
    const after = verifyHeadTags(withNoindex(file()));
    expect(before.ok, 'the real export passes to begin with').toBe(true);
    expect(after.ok).toBe(true);
    expect(after.tagCount).toBe(before.tagCount);
  });

  it('adds exactly one tag, in the first head, and changes nothing else', () => {
    const out = withNoindex(file());
    expect(out.length - file().length).toBe(`\n  ${'<meta name="robots" content="noindex, nofollow">'}`.length);
    expect((out.match(/name="robots"/g) ?? []).length).toBe(1);
    expect(out.indexOf('name="robots"')).toBeLessThan(out.indexOf('<!-- static-head:begin'));
  });

  it('still parses as a bundle, so the published file is not corrupt', () => {
    const out = withNoindex(file());
    expect(() => parseBundle(out)).not.toThrow();
    expect(parseBundle(out).template).toBe(parseBundle(file()).template);
  });
});
