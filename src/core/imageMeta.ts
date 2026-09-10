/**
 * Intrinsic size of an embedded image, read from its header bytes.
 *
 * Done by parsing rather than by loading the bytes into an `Image` element so
 * it is synchronous and testable outside a browser — and so a replacement's
 * dimensions can be checked before anything is written.
 *
 * There is no original filename to recover. The exporter stores each asset as
 * `{ mime, compressed, data }` under a UUID and keeps no name, so the editor
 * shows the UUID and says as much rather than inventing something friendlier.
 */

export interface ImageSize {
  width: number;
  height: number;
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (b[i] !== PNG_MAGIC[i]) return null;
  // IHDR is required to be the first chunk: length, 'IHDR', width, height.
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** Frame markers that carry dimensions. SOF4 (0xC4) and SOF12 (0xCC) do not. */
const SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegSize(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length - 1) {
    if (b[i] !== 0xff) { i++; continue; }
    let marker = b[i + 1];
    // Runs of 0xFF are legal padding before a marker.
    while (marker === 0xff && i + 2 < b.length) { i++; marker = b[i + 1]; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break; // end, or start of scan data
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    if (SOF.has(marker)) {
      // length, precision, height, width
      return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] };
    }
    i += 2 + len;
  }
  return null;
}

function gifSize(b: Uint8Array): ImageSize | null {
  if (b.length < 10) return null;
  if (String.fromCharCode(b[0], b[1], b[2]) !== 'GIF') return null;
  return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RIFF') return null;
  if (String.fromCharCode(b[8], b[9], b[10], b[11]) !== 'WEBP') return null;
  const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fmt === 'VP8 ') return { width: ((b[26] | (b[27] << 8)) & 0x3fff), height: ((b[28] | (b[29] << 8)) & 0x3fff) };
  if (fmt === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fmt === 'VP8X') {
    return {
      width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    };
  }
  return null;
}

/** Returns null for a format we cannot read, rather than guessing a size. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  return pngSize(bytes) ?? jpegSize(bytes) ?? gifSize(bytes) ?? webpSize(bytes);
}

/** Decode base64 to bytes. Only the first chunk is needed for a header read. */
export function base64ToBytes(data: string, limit?: number): Uint8Array {
  const clean = data.replace(/\s/g, '');
  const slice = limit ? clean.slice(0, Math.ceil(limit / 3) * 4) : clean;
  const bin = atob(slice);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  // Chunked: apply() on a multi-megabyte array overflows the call stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/**
 * Size of a base64 asset, decoding as little as will do.
 *
 * A prefix read is not safe at a fixed small size. One of the real images
 * carries a 5,769-byte C2PA provenance block before its frame header, putting
 * the dimensions at byte 6,403 — a 4 KB prefix reports "unknown" for a
 * perfectly ordinary JPEG. So the prefix grows until the header is found, and
 * falls back to the whole asset rather than giving up.
 */
export function imageSizeFromBase64(data: string): ImageSize | null {
  for (const limit of [16_384, 131_072]) {
    const size = imageSize(base64ToBytes(data, limit));
    if (size) return size;
  }
  return imageSize(base64ToBytes(data));
}

export function formatSize(s: ImageSize | null): string {
  return s ? `${s.width} × ${s.height}` : 'size unknown';
}
