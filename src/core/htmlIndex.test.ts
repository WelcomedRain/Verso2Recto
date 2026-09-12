import { describe, it, expect } from 'vitest';
import { indexTemplate } from './htmlIndex';

/**
 * Page content and page information are different jobs, and the Words list used
 * to run them together in document order — putting twenty-eight invisible head
 * strings above the first word anybody can see. Someone looking for the main
 * heading scrolled to the top, opened the first box that would open, and edited
 * the meta description believing it was the heading. Then published it, and
 * quite reasonably reported that the change was nowhere to be seen.
 */
describe('page information vs page content', () => {
  const idx = (html: string) => indexTemplate(html);

  it('marks head furniture as information, whatever its label reads', () => {
    const i = idx(`<html><head>
      <meta name="description" content="a studio">
      <link rel="icon" href="icon.png">
      <title>Anthea</title>
    </head><body><h1>Hello</h1></body></html>`);
    for (const s of i.strings.filter((x) => ['meta', 'link', 'title'].includes(x.tag.split('@')[0])
      || x.label === 'Share / SEO')) {
      expect(s.pageInfo, `${s.label} :: ${s.tag}`).toBe(true);
    }
  });

  it('does not mark a link in the body as information', () => {
    // <a href> is something a reader clicks; <link href> is head furniture.
    // They are one letter apart and were being grouped together.
    const i = idx('<html><body><a href="/x">See the work</a></body></html>');
    const a = i.strings.find((s) => s.tag === 'a' || s.tag.startsWith('a@'));
    expect(a?.pageInfo).toBe(false);
  });

  it('keeps visible text as content', () => {
    const i = idx('<html><body><h1>Hello</h1><p>Words</p></body></html>');
    expect(i.strings.every((s) => !s.pageInfo)).toBe(true);
  });

  it('puts alt text with the content, not the furniture', () => {
    // It is not drawn, but it describes something that is, and it is the
    // author's prose either way.
    const i = idx('<html><body><img src="x.png" alt="A studio photo"></body></html>');
    const alt = i.strings.find((s) => s.tag.includes('alt'));
    expect(alt?.pageInfo).toBe(false);
  });
});
