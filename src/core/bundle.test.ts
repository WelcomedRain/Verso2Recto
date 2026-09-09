import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseBundle, serializeBundle, verifyRoundTrip, listAssets, encodeScriptJson } from './bundle';
import { indexTemplate, applyEdits, tagForPreview, encodeText, decodeEntities } from './htmlIndex';

/**
 * These run against the real antheasolve.com export, not a fixture. The whole
 * risk of this product is that the exporter's format differs from our model of
 * it, and a synthetic fixture would hide exactly that.
 */
const REAL = 'G:/Anthea-Solve/index.html';
const hasReal = existsSync(REAL);
const describeReal = hasReal ? describe : describe.skip;

describe('encodeScriptJson', () => {
  it('escapes slashes so a nested </script> cannot end the block', () => {
    const out = encodeScriptJson('<div></script></div>');
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u002Fscript');
  });

  it('still parses back to the original string', () => {
    const s = '<a href="/x">Hi & bye</a>\n<p>Ünïcode — “quotes”</p>';
    expect(JSON.parse(encodeScriptJson(s))).toBe(s);
  });
});

describe('text indexing', () => {
  it('captures text that follows a nested child, not just the opening run', () => {
    const idx = indexTemplate('<p>Do <b>the</b> thing</p>');
    const vals = idx.strings.filter((s) => s.kind === 'text').map((s) => s.value);
    expect(vals).toEqual(['Do', 'the', 'thing']);
  });

  it('flags runtime placeholders as not directly editable', () => {
    const idx = indexTemplate('<span>{{ availabilityText }}</span><p>Real copy</p>');
    expect(idx.strings.find((s) => s.value.includes('{{'))!.computed).toBe(true);
    expect(idx.strings.find((s) => s.value === 'Real copy')!.computed).toBe(false);
  });

  it('ignores text inside script and style', () => {
    const idx = indexTemplate('<style>.a{color:red}</style><script>var x=1</script><p>Copy</p>');
    expect(idx.strings.filter((s) => s.kind === 'text').map((s) => s.value)).toEqual(['Copy']);
  });
});

describeReal('the real antheasolve.com bundle', () => {
  const source = hasReal ? readFileSync(REAL, 'utf8') : '';

  it('parses', () => {
    const b = parseBundle(source);
    expect(b.template.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(Object.keys(b.manifest).length).toBeGreaterThan(10);
  });

  it('round-trips byte for byte', () => {
    const b = parseBundle(source);
    const r = verifyRoundTrip(b);
    expect(r.detail).toBe('Codec round-trips byte for byte.');
    expect(r.ok).toBe(true);
  });

  it('re-serializing an untouched bundle reproduces the file exactly', () => {
    const b = parseBundle(source);
    expect(serializeBundle(b, { template: b.template })).toBe(source);
  });

  it('indexes a substantial amount of real copy', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    // The prototype managed 12 hand-listed strings. Anything near that means
    // the tokenizer is failing to walk the document.
    expect(idx.strings.length).toBeGreaterThan(150);
    expect(idx.elements.length).toBeGreaterThan(100);
  });

  it('finds the hero heading and the nav links', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const h1 = idx.strings.find((s) => s.tag === 'h1');
    expect(h1?.value).toContain('answers to you');
    const work = idx.strings.find((s) => s.value === 'Work');
    expect(work).toBeDefined();
  });

  it('every indexed span matches the source slice at those offsets', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    for (const s of idx.strings) {
      expect(b.template.slice(s.start, s.end)).toBe(s.raw);
    }
  });

  it('indexed spans never overlap', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const sorted = [...idx.strings].sort((a, x) => a.start - x.start);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end);
    }
  });

  it('editing one string changes only that string', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const h1 = idx.strings.find((s) => s.tag === 'h1')!;
    const next = applyEdits(b.template, [
      { start: h1.start, end: h1.end, replacement: encodeText('Totally new heading') },
    ]);
    expect(next).toContain('Totally new heading');
    expect(next.length).toBe(b.template.length - h1.raw.length + 'Totally new heading'.length);

    const reIdx = indexTemplate(next);
    expect(reIdx.strings.find((s) => s.tag === 'h1')!.value).toBe('Totally new heading');
    // Everything else survived.
    expect(reIdx.strings.length).toBe(idx.strings.length);
  });

  it('an edited bundle still re-parses and round-trips', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const h1 = idx.strings.find((s) => s.tag === 'h1')!;
    const nextTpl = applyEdits(b.template, [
      { start: h1.start, end: h1.end, replacement: encodeText('A & B < C') },
    ]);
    const file = serializeBundle(b, { template: nextTpl });
    const again = parseBundle(file);
    expect(again.template).toBe(nextTpl);
    expect(verifyRoundTrip(again).ok).toBe(true);
    expect(decodeEntities(indexTemplate(again.template).strings.find((s) => s.tag === 'h1')!.raw))
      .toBe('A & B < C');
  });

  it('tags every element for preview without changing the rendered text', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const tagged = tagForPreview(b.template, idx);
    expect((tagged.match(/data-recto-id=/g) ?? []).length).toBe(idx.elements.length);
    // Stripping the tags must give back the original exactly.
    expect(tagged.replace(/ data-recto-id="e\d+"/g, '')).toBe(b.template);
  });

  it('lists the real images', () => {
    const b = parseBundle(source);
    const images = listAssets(b).filter((a) => a.kind === 'image');
    expect(images.length).toBeGreaterThanOrEqual(5);
    expect(images.some((a) => a.bytes > 400_000)).toBe(true);
  });

  it('indexes the share/SEO tags by their property name', () => {
    const b = parseBundle(source);
    const idx = indexTemplate(b.template);
    const ogTitle = idx.strings.find((s) => s.tag === 'og:title');
    expect(ogTitle?.value).toContain('Anthea Solve');
  });
});
