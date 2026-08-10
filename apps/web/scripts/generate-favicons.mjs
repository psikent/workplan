import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), "../public");

const TILE = { cx: 20, cy: 20, hx: 19.5, hy: 19.5, r: 10.5 };
const GLYPH_TRANSLATE = { x: 8, y: 7.6 };
const STROKE = 2.1;
const TILE_COLOR = [0x31, 0x57, 0xdf];
const GLYPH_COLOR = [0xff, 0xff, 0xff];

const GLYPH_RECT = { cx: 12, cy: 13, hx: 9, hy: 9, r: 2 };
const GLYPH_SEGMENTS = [
  [[16, 2], [16, 6]],
  [[3, 10], [21, 10]],
  [[8, 2], [8, 6]],
  [[17, 14], [11, 14]],
  [[13, 18], [7, 18]],
  [[7, 14], [7.01, 14]],
  [[17, 18], [17.01, 18]],
];

function sdRoundRect(p, c) {
  const qx = Math.abs(p.x - c.cx) - (c.hx - c.r);
  const qy = Math.abs(p.y - c.cy) - (c.hy - c.r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - c.r;
}

function sdSegment(p, a, b) {
  const pa = { x: p.x - a[0], y: p.y - a[1] };
  const ba = { x: b[0] - a[0], y: b[1] - a[1] };
  const h = Math.max(0, Math.min(1, (pa.x * ba.x + pa.y * ba.y) / (ba.x * ba.x + ba.y * ba.y)));
  return Math.hypot(pa.x - ba.x * h, pa.y - ba.y * h);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function sample(p) {
  const gp = { x: p.x - GLYPH_TRANSLATE.x, y: p.y - GLYPH_TRANSLATE.y };
  const tileSd = sdRoundRect(p, TILE);
  const tileCover = clamp(0.5 - tileSd, 0, 1);
  let glyphCover = 0;
  if (tileSd < STROKE) {
    glyphCover = Math.max(glyphCover, clamp(STROKE / 2 + 0.5 - Math.abs(sdRoundRect(gp, GLYPH_RECT)), 0, 1));
    for (const [a, b] of GLYPH_SEGMENTS) {
      glyphCover = Math.max(glyphCover, clamp(STROKE / 2 + 0.5 - sdSegment(gp, a, b), 0, 1));
    }
  }
  return { cover: tileCover, glyph: glyphCover };
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = {
            x: ((x + (sx + 0.5) / SS) / size) * 40,
            y: ((y + (sy + 0.5) / SS) / size) * 40,
          };
          const s = sample(p);
          const mix = s.glyph;
          r += TILE_COLOR[0] * (1 - mix) + GLYPH_COLOR[0] * mix;
          g += TILE_COLOR[1] * (1 - mix) + GLYPH_COLOR[1] * mix;
          b += TILE_COLOR[2] * (1 - mix) + GLYPH_COLOR[2] * mix;
          a += s.cover;
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round((a / n) * 255);
    }
  }
  return rgba;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeIco(sizes) {
  const pngs = sizes.map((size) => ({ size, data: encodePng(render(size), size) }));
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + count * 16;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const GLYPH_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">',
  '<rect x="0.5" y="0.5" width="39" height="39" rx="10.5" fill="#3157df"/>',
  '<g transform="translate(8 7.6)" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none">',
  '<rect x="3" y="4" width="18" height="18" rx="2"/>',
  '<path d="M16 2v4"/>',
  '<path d="M3 10h18"/>',
  '<path d="M8 2v4"/>',
  '<path d="M17 14h-6"/>',
  '<path d="M13 18H7"/>',
  '<path d="M7 14h.01"/>',
  '<path d="M17 18h.01"/>',
  "</g>",
  "</svg>",
].join("\n");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "favicon.svg"), GLYPH_SVG);
writeFileSync(join(outDir, "favicon.ico"), encodeIco([16, 32, 48, 256]));
writeFileSync(join(outDir, "apple-touch-icon.png"), encodePng(render(180), 180));
writeFileSync(join(outDir, "brand-preview.png"), encodePng(render(256), 256));
console.log("favicons written to", outDir);
