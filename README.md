# Verso2Recto

An offline-first PWA for editing a GitHub-hosted static site — click any words on
the rendered page, change them, and publish with one button. Built for
[antheasolve.com](https://antheasolve.com) (`WelcomedRain/Anthea-Solve`).

Git is deliberately hidden. No branches, no PRs, no merge UI — one author, one
branch, one button.

## Status

Milestone 1 (universal click-to-edit copy) is working end to end:

- Opens a repo over the GitHub REST API and keeps a complete copy in IndexedDB.
- Renders the real page in an iframe; **every** element is clickable.
- **199 editable strings** indexed on the target site, against the design
  prototype's 12 hand-listed ones.
- Edits update the rendered page live and survive a restart.
- Publish runs the five-step pipeline with the head-tag verification gate.

Not built yet: styling controls, image replacement, the offline auto-publish
queue drain, and multi-file editing. See *What's next*.

## How it works

A Claude Design export is a ~400-line HTML wrapper around two single-line JSON
payloads:

```
<script type="__bundler/manifest">   { uuid: { mime, compressed, data } }   ← 2 MB of base64 assets
<script type="__bundler/template">   "<!DOCTYPE html>…"                     ← the whole page, JSON-encoded
```

So editing is: decode the template string → index it → patch a byte range →
re-encode → put the line back. All of that lives in
[`src/core/bundle.ts`](src/core/bundle.ts) and
[`src/core/htmlIndex.ts`](src/core/htmlIndex.ts).

Three things about that were not obvious and are worth knowing before touching
the codec:

**1. Slashes must be re-escaped, or you silently corrupt the site.**
The template contains literal `</script>` sequences. Unescaped, the HTML parser
ends the `<script type="__bundler/template">` element at the first one and the
rest of the page leaks into the document as raw markup. The exporter escapes the
`/` of a closing tag only — `image/png` keeps its slash. `verifyRoundTrip()`
asserts byte equality against the original so a codec drift fails a test rather
than a deploy.

**2. Unknown attributes survive into the rendered DOM.**
This is what makes click-to-select possible without restructuring the site. We
stamp `data-recto-id` on every element for the preview, the Claude Design runtime
passes it straight through, and a click maps back to an exact byte range. The
tagged document is never written to disk.

**3. The site already has theme tokens.**
The bundle carries a real `:root` block (`--gold`, `--ink`, `--on-ink`, plus the
full Modernist ramp) and elements reference them as `var(--ink)`. Theme editing
is therefore patching six values, not the bulk find-and-replace the design brief
assumed.

## The publish gate

```
1. Write edits into the working copy      → written
2. Rebuild index.html                     → rebuilt
3. Move the share tags into <head>        → spliced
4. Verify they are literal HTML in <head> → verified   ← HARD GATE
5. Commit and push                        → pushed | queued (offline)
```

Step 4 refuses to publish if the Open Graph and meta tags are not literal HTML
inside `<head>`. The failure it guards against is silent: the build goes green,
the site looks perfect, and every link preview is dead. `verifyHeadTags()` is
deliberately dumb — a scraper does not run JavaScript or repair malformed markup,
so neither does the check.

## Running it

```bash
npm install
npm run dev
```

Then connect with a **fine-grained** personal access token scoped to
*Contents: read and write* on the one repository, and nothing else. The token is
held in IndexedDB on your device and sent only to `api.github.com`.

```bash
npm test          # 25 tests, run against the real antheasolve.com export
npm run build
```

The tests read `G:/Anthea-Solve/index.html` directly and skip if it is absent.
That is deliberate: the entire risk here is that the exporter's format differs
from our model of it, and a synthetic fixture would hide exactly that.

## What's next

- **Styling** — a Style tab for the selected element's real declarations, and a
  Theme panel over the `:root` block. Cheaper than the brief assumed.
- **Image replacement** — the 6 images are base64 in the manifest, keyed by UUID
  and referenced by bare UUID in the template. Swapping one is a manifest write.
- **Offline queue drain** — publish while offline currently completes steps 1–4
  and holds; it does not yet publish itself on reconnect.
- **Export detection** — patches are already stored with a content fingerprint so
  an export that clobbers the bundle can be detected and re-applied.

## Layout

```
src/core/bundle.ts      the export format: parse, encode, round-trip proof
src/core/htmlIndex.ts   byte-exact HTML tokenizer and the string index
src/core/publish.ts     the five steps and the head-tag gate
src/core/github.ts      REST client — blobs, trees, one commit per publish
src/core/db.ts          IndexedDB working copy, queue, replayable patches
src/app/                the editor UI, built on the Modernist design system
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free to use, study and modify for any
noncommercial purpose; not for sale or for folding into a commercial product.
See [NOTICE.md](NOTICE.md) for the plain-English version.

Copyright (c) 2026 Gene Bernardin.
