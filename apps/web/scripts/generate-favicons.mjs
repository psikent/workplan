import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const defaultOutDir = join(scriptDir, "../public");
const geometry = JSON.parse(readFileSync(join(scriptDir, "../src/assets/brand-icon.json"), "utf8"));

const TILE = { cx: 20, cy: 20, hx: 19.5, hy: 19.5, r: 10.5 };
const GLYPH_INSET = 6;
const GLYPH_SIZE = 28;
const TILE_COLOR = [0x08, 0x91, 0xb2];
const GLYPH_COLOR = [0xff, 0xff, 0xff];

function sdRoundRect(p, c) {
  const qx = Math.abs(p.x - c.cx) - (c.hx - c.r);
  const qy = Math.abs(p.y - c.cy) - (c.hy - c.r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - c.r;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function insideRoundedRect(p, shape) {
  return sdRoundRect(p, {
    cx: shape.x + shape.width / 2,
    cy: shape.y + shape.height / 2,
    hx: shape.width / 2,
    hy: shape.height / 2,
    r: shape.radius,
  }) <= 0;
}

function insideBottomRoundedRect(p, shape) {
  if (p.x < shape.x || p.x > shape.x + shape.width || p.y < shape.y || p.y > shape.y + shape.height) return false;
  const curveStart = shape.y + shape.height - shape.bottomRadius;
  if (p.y <= curveStart) return true;
  const leftCenter = shape.x + shape.bottomRadius;
  const rightCenter = shape.x + shape.width - shape.bottomRadius;
  if (p.x >= leftCenter && p.x <= rightCenter) return true;
  const cx = p.x < leftCenter ? leftCenter : rightCenter;
  return Math.hypot(p.x - cx, p.y - curveStart) <= shape.bottomRadius;
}

function insideCircle(p, cx, cy, radius) {
  return Math.hypot(p.x - cx, p.y - cy) <= radius;
}

function insideGlyph(p) {
  let inside = insideRoundedRect(p, geometry.shell);
  if (insideBottomRoundedRect(p, geometry.pageCutout)) inside = false;
  if (geometry.notches.some((shape) => insideRoundedRect(p, shape))) inside = false;
  if (geometry.binders.some((shape) => insideRoundedRect(p, shape))) inside = true;

  const { cx, cy, outerRadius, innerRadius } = geometry.clock;
  if (insideCircle(p, cx, cy, outerRadius) && !insideCircle(p, cx, cy, innerRadius)) inside = true;
  if (geometry.hands.some((shape) => insideRoundedRect(p, shape))) inside = true;
  return inside;
}

function sample(p, maskable) {
  const tileSd = sdRoundRect(p, TILE);
  const tileCover = maskable ? 1 : clamp(0.5 - tileSd, 0, 1);
  const sourcePoint = {
    x: ((p.x - GLYPH_INSET) / GLYPH_SIZE) * geometry.canvasSize,
    y: ((p.y - GLYPH_INSET) / GLYPH_SIZE) * geometry.canvasSize,
  };
  const glyphCover = insideGlyph(sourcePoint) ? 1 : 0;
  return {
    cover: tileCover,
    color: TILE_COLOR.map((channel, index) => channel * (1 - glyphCover) + GLYPH_COLOR[index] * glyphCover),
  };
}

function renderWithSampler(size, sampler) {
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
          const s = sampler(p);
          r += s.color[0];
          g += s.color[1];
          b += s.color[2];
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

function render(size, maskable = false) {
  return renderWithSampler(size, (p) => sample(p, maskable));
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

function bottomRoundedRectPath(shape) {
  const right = shape.x + shape.width;
  const bottom = shape.y + shape.height;
  const curveY = bottom - shape.bottomRadius;
  return `M${shape.x} ${shape.y}H${right}V${curveY}A${shape.bottomRadius} ${shape.bottomRadius} 0 0 1 ${right - shape.bottomRadius} ${bottom}H${shape.x + shape.bottomRadius}A${shape.bottomRadius} ${shape.bottomRadius} 0 0 1 ${shape.x} ${curveY}Z`;
}

function roundedRectSvg(shape, fill) {
  return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.radius}" fill="${fill}"/>`;
}

const glyphScale = GLYPH_SIZE / geometry.canvasSize;
const GLYPH_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">',
  '<style>.tile{fill:#0891b2}.glyph{fill:#fff}@media (prefers-color-scheme:dark){.tile{fill:#22d3ee}.glyph{fill:#020617}}</style>',
  `<defs><mask id="brand-glyph" maskUnits="userSpaceOnUse" x="0" y="0" width="${geometry.canvasSize}" height="${geometry.canvasSize}">`,
  roundedRectSvg(geometry.shell, "white"),
  `<path d="${bottomRoundedRectPath(geometry.pageCutout)}" fill="black"/>`,
  ...geometry.notches.map((shape) => roundedRectSvg(shape, "black")),
  ...geometry.binders.map((shape) => roundedRectSvg(shape, "white")),
  `<circle cx="${geometry.clock.cx}" cy="${geometry.clock.cy}" r="${geometry.clock.outerRadius}" fill="white"/>`,
  `<circle cx="${geometry.clock.cx}" cy="${geometry.clock.cy}" r="${geometry.clock.innerRadius}" fill="black"/>`,
  ...geometry.hands.map((shape) => roundedRectSvg(shape, "white")),
  '</mask></defs>',
  '<rect class="tile" x="0.5" y="0.5" width="39" height="39" rx="10.5"/>',
  `<g transform="translate(${GLYPH_INSET} ${GLYPH_INSET}) scale(${glyphScale})">`,
  `<rect class="glyph" width="${geometry.canvasSize}" height="${geometry.canvasSize}" mask="url(#brand-glyph)"/>`,
  "</g>",
  "</svg>",
].join("\n");

export function renderIconPng(size, maskable = false) {
  return encodePng(render(size, maskable), size);
}

export function generateFavicons(outDir = defaultOutDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "favicon.svg"), GLYPH_SVG);
  writeFileSync(join(outDir, "favicon.ico"), encodeIco([16, 32, 48, 256]));
  writeFileSync(join(outDir, "apple-touch-icon.png"), renderIconPng(512, true));
  writeFileSync(join(outDir, "brand-preview.png"), renderIconPng(256));
  writeFileSync(join(outDir, "pwa-192x192.png"), renderIconPng(192));
  writeFileSync(join(outDir, "pwa-512x512.png"), renderIconPng(512));
  writeFileSync(join(outDir, "pwa-maskable-192x192.png"), renderIconPng(192, true));
  writeFileSync(join(outDir, "pwa-maskable-512x512.png"), renderIconPng(512, true));
  console.log("favicons written to", outDir);
}

export { GLYPH_SVG as faviconSvg };

if (resolve(process.argv[1] ?? "") === scriptPath) {
  const requestedOutDir = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : defaultOutDir;
  generateFavicons(requestedOutDir);
}
