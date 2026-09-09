/**
 * Read and write the Claude Design export format.
 *
 * A exported `index.html` is a ~400-line wrapper around two single-line JSON
 * payloads:
 *
 *   <script type="__bundler/manifest">   → { uuid: { mime, compressed, data } }
 *   <script type="__bundler/template">   → "<!DOCTYPE html>…" (the whole page)
 *
 * Both are on the line *following* their opening tag.
 */

export interface ManifestEntry {
  mime: string;
  compressed: boolean;
  data: string;
}

export type Manifest = Record<string, ManifestEntry>;

export interface Bundle {
  /** The original file, unmodified. */
  source: string;
  lines: string[];
  manifestLine: number;
  templateLine: number;
  manifest: Manifest;
  /** The decoded page HTML. All indexing and editing happens against this. */
  template: string;
}

const MANIFEST_TAG = '<script type="__bundler/manifest">';
const TEMPLATE_TAG = '<script type="__bundler/template">';

function findPayloadLine(lines: string[], tag: string, what: string): number {
  const tagLine = lines.findIndex((l) => l.includes(tag));
  if (tagLine === -1) throw new Error(`Not a Claude Design export: no ${what} block found.`);
  for (let i = tagLine + 1; i < lines.length; i++) {
    if (lines[i].trim()) return i;
  }
  throw new Error(`The ${what} block is empty.`);
}

export function parseBundle(source: string): Bundle {
  const lines = source.split('\n');
  const manifestLine = findPayloadLine(lines, MANIFEST_TAG, 'asset manifest');
  const templateLine = findPayloadLine(lines, TEMPLATE_TAG, 'page template');

  let manifest: Manifest;
  let template: string;
  try {
    manifest = JSON.parse(lines[manifestLine].trim());
  } catch (e) {
    throw new Error(`The asset manifest is not valid JSON: ${(e as Error).message}`);
  }
  try {
    template = JSON.parse(lines[templateLine].trim());
  } catch (e) {
    throw new Error(`The page template is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof template !== 'string') throw new Error('The page template is not a string.');

  return { source, lines, manifestLine, templateLine, manifest, template };
}

/**
 * Encode a string for embedding inside a <script> block.
 *
 * `JSON.stringify` alone is NOT sufficient and will corrupt the file. The page
 * template contains literal `</script>` sequences; left unescaped, the HTML
 * parser terminates the enclosing <script type="__bundler/template"> element at
 * the first one and the remainder of the page leaks into the document as raw
 * markup.
 *
 * The exporter's rule, established by diffing its output: escape the `/` of a
 * closing tag (`</` becomes `<` + `/`) and leave every other slash alone,
 * so `image/png` and `https://…` stay readable. Matching it exactly is what
 * lets `verifyRoundTrip` assert byte equality, which is our evidence that we
 * understand the format rather than merely producing something that parses.
 *
 * The failure this prevents is silent: the file still parses as HTML and the
 * build still goes green.
 */
export function encodeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\u002F');
}

/** Re-emit the file with a new template and/or manifest. */
export function serializeBundle(
  bundle: Bundle,
  next: { template?: string; manifest?: Manifest },
): string {
  const lines = [...bundle.lines];
  if (next.template !== undefined) {
    lines[bundle.templateLine] = encodeScriptJson(next.template);
  }
  if (next.manifest !== undefined) {
    lines[bundle.manifestLine] = encodeScriptJson(next.manifest);
  }
  return lines.join('\n');
}

/**
 * Round-trip check used by the publish gate.
 *
 * Re-encoding an untouched bundle must reproduce the original payload lines
 * byte for byte. If it does not, our codec disagrees with the exporter's and we
 * refuse to write rather than risk a corrupted site.
 */
export function verifyRoundTrip(bundle: Bundle): { ok: boolean; detail: string } {
  const tpl = encodeScriptJson(bundle.template);
  if (tpl !== bundle.lines[bundle.templateLine].trim()) {
    return { ok: false, detail: 'Template re-encoding does not reproduce the original bytes.' };
  }
  const man = encodeScriptJson(bundle.manifest);
  if (man !== bundle.lines[bundle.manifestLine].trim()) {
    return { ok: false, detail: 'Manifest re-encoding does not reproduce the original bytes.' };
  }
  return { ok: true, detail: 'Codec round-trips byte for byte.' };
}

export interface AssetInfo {
  uuid: string;
  mime: string;
  compressed: boolean;
  /** Decoded byte length. */
  bytes: number;
  kind: 'image' | 'font' | 'script' | 'other';
  /** Where the page references it. */
  usedBy: string[];
}

function kindOf(mime: string): AssetInfo['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('font/')) return 'font';
  if (mime.includes('javascript')) return 'script';
  return 'other';
}

export function listAssets(bundle: Bundle): AssetInfo[] {
  return Object.entries(bundle.manifest).map(([uuid, entry]) => {
    const usedBy: string[] = [];
    // Crude but sufficient: the template references assets by bare UUID.
    let from = 0;
    while (usedBy.length < 8) {
      const at = bundle.template.indexOf(uuid, from);
      if (at === -1) break;
      const before = bundle.template.lastIndexOf('<', at);
      const tagName = bundle.template.slice(before + 1, before + 12).split(/[\s>]/)[0];
      usedBy.push(tagName || 'unknown');
      from = at + uuid.length;
    }
    return {
      uuid,
      mime: entry.mime,
      compressed: entry.compressed,
      bytes: Math.round((entry.data.length * 3) / 4),
      kind: kindOf(entry.mime),
      usedBy: [...new Set(usedBy)],
    };
  });
}

/** A data: URL for previewing an asset outside the page. */
export function assetDataUrl(entry: ManifestEntry): string {
  return `data:${entry.mime};base64,${entry.data}`;
}
