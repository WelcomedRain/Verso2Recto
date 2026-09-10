# RectoVeritas

An offline-first PWA for editing a GitHub-hosted static site — click any words on
the rendered page, change them, and publish with one button. Built for
[antheasolve.com](https://antheasolve.com) (`WelcomedRain/Anthea-Solve`).

Git is deliberately hidden. No branches, no PRs, no merge UI — one author, one
branch, one button.

## Status

Copy editing and styling both work end to end:

- Opens a repo over the GitHub REST API and keeps a complete copy in IndexedDB.
- Renders the real page in an iframe; **every** element is clickable.
- **199 editable strings** indexed on the target site, against the design
  prototype's 12 hand-listed ones — plus inline style declarations and theme
  tokens, for **700+ editable targets** in total.
- **Style** tab: change one element's own declarations.
- **Theme** tab: change a `:root` token and everything referencing it moves.
- Edits update the rendered page live and survive a restart.
- Publish runs the five-step pipeline with the head-tag verification gate.
- Queued edits that no longer match the page — what a re-export looks like from
  in here — are counted and reported rather than silently published or dropped.

Not built yet: image replacement, the offline auto-publish queue drain, and
multi-file editing. See *What's next*.

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
The bundle carries real `:root` blocks (`--gold`, `--ink`, `--on-ink`, plus the
full Modernist ramp) and elements reference them as `var(--ink)`. Theme editing
is therefore patching a handful of values, not the one-time source surgery or
34-place find-and-replace the design brief assumed.

**4. Encoding depends on where the value lives.**
Three contexts, three rules, and using the wrong one corrupts the file quietly.
Page text is entity-encoded. An inline style value sits inside `style="…"`, so
it is an attribute value first and CSS second. A theme value sits in `<style>`
raw text, where entities are *not* decoded — writing `&amp;` there produces a
literal `&amp;` in the stylesheet. `encodeFor()` holds all three in one place
with the reasoning attached.

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
npm test          # 57 tests, run against the real antheasolve.com export
npm run build
```

The tests read `G:/Anthea-Solve/index.html` directly and skip if it is absent.
That is deliberate: the entire risk here is that the exporter's format differs
from our model of it, and a synthetic fixture would hide exactly that.

## Styling

Two halves, matching the stated priority of "theme values AND per-element
override":

- **Theme** — custom properties inside `:root`. One edit, many elements. The
  site's own seven tokens are shown first; the design system's 48 are behind a
  disclosure, since changing those reaches further than people expect.
- **Style** — declarations from the selected element's `style` attribute. The
  dozen properties people actually reach for are surfaced first, the rest behind
  "show more". Nothing is hidden, just ordered.
- **On hover** — `style-hover` is the Claude Design runtime's own attribute, not
  a web standard. It parses and patches like any other declaration list, and
  until now the editor could not see it at all: you could change a button's
  colour but not what it does on hover, and nothing said why.

A hover style is invisible while you edit it — your pointer is over the panel,
not the page — so the panel can hold an element in its hover appearance. Editing
a hover value engages that hold automatically.

Worth knowing: the runtime **consumes** `style-hover` while rendering and wires
its own handlers, so no element carries it in the live DOM (293 carry
`data-recto-id`, which it passes straight through). The page cannot be told
about a hover change, which is why the hold applies the declarations inline
rather than writing the attribute back. Actually hovering the element in the
preview still shows the value captured at render; the hold is the accurate
preview until you publish.

Live preview works by setting the property on the element, or the custom
property on `<html>` — an inline custom property outranks the `:root` rule, so
the page updates without its stylesheet being touched.

Values that are computed at runtime (`{{ availabilityText }}`) are shown
read-only with an explanation, rather than offered as editable and then
silently overwritten on render.

## Editing the code

Scoped to one element rather than the whole file. The page is a single 58 KB
line of compiled output, so a free-roaming editor over it would invite exactly
the accidental damage the rest of this app works to prevent — and the lines in
Code view are derived for reading, not a real document to type into.

An element is the right unit: it is what you selected, it has exact boundaries,
its replacement can be checked before anything is written, and a mistake is
confined to it. Select anything, open **Edit this code**, and you get that
element's exact source.

Every edit is validated before it can be applied. The failure worth refusing is
an unclosed tag: it does not break the page visibly, it makes every following
sibling a child of it. `<div><p>text</div>` is rejected too — a browser
silently recovers from closing an ancestor around an open child, which is
precisely why it has to be reported.

A code edit supersedes anything queued inside the element it replaces, since
the new markup is the more recent and more specific statement of intent. The
app says so when it happens rather than dropping the work quietly.

## Images

The six images are base64 in the asset manifest, keyed by UUID, and the page
references them by that bare UUID. So replacing one is a manifest write and
nothing else — no markup change, no reference to rewrite, and no change to the
site's own source. The design brief said these needed a rebuild; they do not.

Selection works both ways: click an image in the page and Images opens with it
selected; click a row and it is found and outlined in the page. The lookup uses
the source, not the DOM, because the runtime rewrites each `src` to a blob URL
when it renders.

Dimensions are read from the image's own header bytes, so they are its real
size rather than however the page displays it. A fixed small prefix is not
enough: one asset carries a 5,769-byte C2PA provenance block that puts its
frame header at byte 6,403, so the prefix grows until the header is found.

There is no original filename to show. The exporter stores each asset as
`{ mime, compressed, data }` under a UUID and keeps no name, so the editor
shows the id and says so rather than inventing something friendlier.

## What's next

- **Offline queue drain** — publish while offline currently completes steps 1–4
  and holds; it does not yet publish itself on reconnect.
- **Re-applying after an export** — orphaned edits are already detected and
  reported. Replaying them onto a fresh bundle by matching on content rather
  than byte offset is the remaining half.

## Layout

```
src/core/bundle.ts      the export format: parse, encode, round-trip proof
src/core/htmlIndex.ts   byte-exact HTML tokenizer and the string index
src/core/css.ts         declaration and :root parsing, with byte ranges
src/core/targets.ts     one address space for words, styles and theme tokens
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
