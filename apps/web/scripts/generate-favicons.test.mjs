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
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    expect(raw[row]).toBe(0);
    raw.copy(pixels, y * stride, row + 1, row + 1 + stride);
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
  it("uses an opaque flat cyan field with a white calendar glyph", () => {
    const icon = decodePng(join(outputDir, "apple-touch-icon.png"));
    const flatCyan = [0x08, 0x91, 0xb2, 0xff];

    expect([icon.width, icon.height]).toEqual([180, 180]);
    expect(pixelAt(icon, 0, 0)).toEqual(flatCyan);
    expect(pixelAt(icon, 179, 179)).toEqual(flatCyan);

    let whitePixels = 0;
    let offAxisPixels = 0;
    for (let offset = 0; offset < icon.pixels.length; offset += 4) {
      expect(icon.pixels[offset + 3]).toBe(0xff);
      const red = icon.pixels[offset];
      const green = icon.pixels[offset + 1];
      const blue = icon.pixels[offset + 2];
      const whiteMix = (red - flatCyan[0]) / (0xff - flatCyan[0]);
      const expectedGreen = Math.round(flatCyan[1] + (0xff - flatCyan[1]) * whiteMix);
      const expectedBlue = Math.round(flatCyan[2] + (0xff - flatCyan[2]) * whiteMix);
      if (
        red < flatCyan[0]
        || red > 0xff
        || Math.abs(green - expectedGreen) > 1
        || Math.abs(blue - expectedBlue) > 1
      ) {
        offAxisPixels++;
      }
      if (red === 0xff && green === 0xff && blue === 0xff) {
        whitePixels++;
      }
    }
    expect(offAxisPixels).toBe(0);
    expect(whitePixels).toBeGreaterThan(500);
  });

  it("keeps the detailed cyan treatment for PWA icons", () => {
    const icon = decodePng(join(outputDir, "pwa-maskable-192x192.png"));
    expect(pixelAt(icon, 0, 0)).not.toEqual([0x08, 0x91, 0xb2, 0xff]);
  });
});
