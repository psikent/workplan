import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = mkdtempSync(join(tmpdir(), "workplan-favicons-"));

function decodePng(path) {
  const png = readFileSync(path);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  let offset = 8;
  let width;
  let height;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([...data.subarray(8, 13)]).toEqual([8, 6, 0, 0, 0]);
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += length + 12;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  const stride = width * 4;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    const filter = raw[row];
    const current = y * stride;
    const previous = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[current + x - 4] : 0;
      const up = y > 0 ? pixels[previous + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[previous + x - 4] : 0;
      const value = raw[row + 1 + x];
      pixels[current + x] = filter === 0
        ? value
        : filter === 1
          ? (value + left) & 0xff
          : filter === 2
            ? (value + up) & 0xff
            : filter === 3
              ? (value + Math.floor((left + up) / 2)) & 0xff
              : (value + paeth(left, up, upperLeft)) & 0xff;
    }
  }
  return { width, height, pixels };
}

function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return [...image.pixels.subarray(offset, offset + 4)];
}

beforeAll(() => {
  const result = spawnSync(process.execPath, [join(scriptDir, "generate-favicons.mjs"), relative(process.cwd(), outputDir)], {
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
});

afterAll(() => {
  rmSync(outputDir, { recursive: true, force: true });
});

describe("generated Apple Touch icon", () => {
  it("copies the approved transparent calendar artwork exactly", () => {
    const sourcePath = join(scriptDir, "calendar-icon.png");
    const source = readFileSync(sourcePath);
    const generated = readFileSync(join(outputDir, "apple-touch-icon.png"));
    const published = readFileSync(join(scriptDir, "../public/apple-touch-icon.png"));
    const sourceImage = decodePng(sourcePath);

    expect(generated).toEqual(source);
    expect(published).toEqual(source);
    expect([sourceImage.width, sourceImage.height]).toEqual([512, 512]);
    let alphaMin = 0xff;
    let alphaMax = 0;
    for (let offset = 3; offset < sourceImage.pixels.length; offset += 4) {
      alphaMin = Math.min(alphaMin, sourceImage.pixels[offset]);
      alphaMax = Math.max(alphaMax, sourceImage.pixels[offset]);
    }
    expect(alphaMin).toBe(0);
    expect(alphaMax).toBe(0xff);
  });

  it("keeps the detailed cyan treatment for PWA icons", () => {
    const icon = decodePng(join(outputDir, "pwa-maskable-192x192.png"));
    expect(pixelAt(icon, 0, 0)).not.toEqual([0x08, 0x91, 0xb2, 0xff]);
  });
});
