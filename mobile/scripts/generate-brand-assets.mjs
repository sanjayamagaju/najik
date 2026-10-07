/**
 * Generates the Najik brand bitmaps (app icon, adaptive icon layers, splash mark,
 * Android notification icon) from pure geometry so they are reproducible without
 * design tooling. Run: `node scripts/generate-brand-assets.mjs`.
 *
 * The mark is a solid dot flanked by two pairs of "ping" arcs: (( • )).
 */
import { Buffer } from 'node:buffer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images');
mkdirSync(root, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Coverage (0..1) of the mark at point (x, y) in unit space centred on 0, mark radius ~1. */
function markCoverage(x, y, px) {
  const d = Math.hypot(x, y);
  const aa = (dist) => clamp01(0.5 - dist / px);
  let cov = aa(d - 0.2); // centre dot
  const angle = Math.abs(Math.atan2(y, Math.abs(x))); // 0 = horizontal, mirrored left/right
  const arcSpan = (50 * Math.PI) / 180;
  for (const [r, w] of [
    [0.52, 0.11],
    [0.84, 0.11],
  ]) {
    const ring = aa(Math.abs(d - r) - w / 2);
    // round caps: distance to the arc end points
    const endA = arcSpan;
    const capDist = Math.min(
      Math.hypot(Math.abs(x) - r * Math.cos(endA), Math.abs(y) - r * Math.sin(endA)),
    );
    const inSpan = angle <= arcSpan ? ring : aa(capDist - w / 2);
    cov = Math.max(cov, inSpan);
  }
  return cov;
}

function render(size, { background, markColor = '#FFFFFF', markScale }) {
  const buf = Buffer.alloc(size * size * 4);
  const [mr, mg, mb] = hex(markColor);
  const from = background ? hex(background[0]) : null;
  const to = background ? hex(background[1]) : null;
  const px = 2 / (size * markScale);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const ux = ((x + 0.5) / size - 0.5) * (2 / markScale);
      const uy = ((y + 0.5) / size - 0.5) * (2 / markScale);
      const cov = markScale > 0 ? markCoverage(ux, uy, px) : 0;
      if (from && to) {
        const t = clamp01((x + y) / (2 * size));
        const bg = from.map((c, k) => c + (to[k] - c) * t);
        buf[i] = Math.round(bg[0] + (mr - bg[0]) * cov);
        buf[i + 1] = Math.round(bg[1] + (mg - bg[1]) * cov);
        buf[i + 2] = Math.round(bg[2] + (mb - bg[2]) * cov);
        buf[i + 3] = 255;
      } else {
        buf[i] = mr;
        buf[i + 1] = mg;
        buf[i + 2] = mb;
        buf[i + 3] = Math.round(cov * 255);
      }
    }
  }
  return encodePng(size, buf);
}

const brand = ['#8B5CFF', '#3F2FD1'];
const out = {
  'icon.png': render(1024, { background: brand, markScale: 0.62 }),
  'android-icon-background.png': render(1024, { background: brand, markScale: 0 }),
  'android-icon-foreground.png': render(1024, { markScale: 0.42 }),
  'android-icon-monochrome.png': render(1024, { markScale: 0.42 }),
  'splash-icon.png': render(512, { markScale: 0.9 }),
  'notification-icon.png': render(96, { markScale: 0.9 }),
};
for (const [name, png] of Object.entries(out)) {
  writeFileSync(join(root, name), png);
  console.log(`wrote ${name} (${png.length} bytes)`);
}
