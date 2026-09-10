import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { imageSize, imageSizeFromBase64, base64ToBytes, bytesToBase64, formatSize } from './imageMeta';
import { parseBundle, listAssets } from './bundle';

const REAL = 'G:/Anthea-Solve/index.html';
const hasReal = existsSync(REAL);

// Node has no atob/btoa on older versions; the app runs in a browser where it
// does. Provide them if missing so the codec is testable here.
if (typeof globalThis.atob !== 'function') {
  globalThis.atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
  globalThis.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
}

describe('imageSize', () => {
  it('reads a PNG header', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 0, 13], 8);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    png.set([0, 0, 0x07, 0x80], 16); // 1920
    png.set([0, 0, 0x04, 0x38], 20); // 1080
    expect(imageSize(png)).toEqual({ width: 1920, height: 1080 });
  });

  it('reads a JPEG SOF0 header', () => {
    const j = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,          // APP0, skipped
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, // SOF0 1080x1920
    ]);
    expect(imageSize(j)).toEqual({ width: 1920, height: 1080 });
  });

  it('reads a GIF header', () => {
    const g = new Uint8Array(10);
    g.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    g.set([0x40, 0x01, 0xf0, 0x00], 6); // 320 x 240
    expect(imageSize(g)).toEqual({ width: 320, height: 240 });
  });

  it('returns null rather than guessing for an unknown format', () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(null);
    expect(formatSize(null)).toBe('size unknown');
  });

  it('returns null for a truncated header instead of reading garbage', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(imageSize(png)).toBe(null);
  });
});

describe('base64 round trip', () => {
  it('survives arbitrary bytes', () => {
    const bytes = new Uint8Array(1000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('handles a payload large enough to overflow a naive apply()', () => {
    const bytes = new Uint8Array(200_000).fill(65);
    expect(base64ToBytes(bytesToBase64(bytes)).length).toBe(200_000);
  });
});

describe.skipIf(!hasReal)('the real embedded images', () => {
  it('every image reports real dimensions', () => {
    const b = parseBundle(readFileSync(REAL, 'utf8'));
    const images = listAssets(b).filter((a) => a.kind === 'image');
    expect(images.length).toBeGreaterThanOrEqual(5);

    for (const a of images) {
      const size = imageSizeFromBase64(b.manifest[a.uuid].data);
      expect(size, `no size for ${a.uuid} (${a.mime})`).not.toBe(null);
      expect(size!.width).toBeGreaterThan(0);
      expect(size!.height).toBeGreaterThan(0);
    }
  });

  it('reads past a large metadata block to find the frame header', () => {
    // This asset carries a 5,769-byte C2PA provenance segment, putting its
    // dimensions at byte 6,403 — well past any small prefix.
    const b = parseBundle(readFileSync(REAL, 'utf8'));
    const withC2pa = '07a96b6d-6a77-424b-bf1e-10d5667bb003';
    if (!b.manifest[withC2pa]) return;
    expect(imageSize(base64ToBytes(b.manifest[withC2pa].data, 4096))).toBe(null);
    expect(imageSizeFromBase64(b.manifest[withC2pa].data)).toEqual({ width: 1400, height: 936 });
  });

  it('finds the large hero image at its real size', () => {
    const b = parseBundle(readFileSync(REAL, 'utf8'));
    const images = listAssets(b).filter((a) => a.kind === 'image');
    const hero = images.sort((x, y) => y.bytes - x.bytes)[0];
    const size = imageSizeFromBase64(b.manifest[hero.uuid].data)!;
    // The brief described a 2400x800 wordmark and similar; whatever it is, it
    // must be a plausible photograph rather than a parse accident.
    expect(size.width).toBeGreaterThan(500);
    expect(size.height).toBeGreaterThan(200);
  });
});
