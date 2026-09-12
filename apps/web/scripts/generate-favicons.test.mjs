import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { faviconSvg, renderIconPng } from "./generate-favicons.mjs";

function decodePng(png) {
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

describe("generated brand icons", () => {
  it("renders the supplied calendar-clock silhouette on the brand tile", () => {
    const icon = decodePng(renderIconPng(64));

    expect([icon.width, icon.height]).toEqual([64, 64]);
    expect(pixelAt(icon, 0, 0)[3]).toBe(0);
    expect(pixelAt(icon, 21, 21)).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect(pixelAt(icon, 32, 32)).toEqual([0x08, 0x91, 0xb2, 0xff]);
  });

  it("keeps maskable corners opaque in the stable light-theme colors", () => {
    const icon = decodePng(renderIconPng(64, true));

    expect(pixelAt(icon, 0, 0)).toEqual([0x08, 0x91, 0xb2, 0xff]);
  });

  it("makes the SVG favicon follow the light and dark theme palettes", () => {
    expect(faviconSvg).toContain("prefers-color-scheme:dark");
    expect(faviconSvg).toContain("#0891b2");
    expect(faviconSvg).toContain("#22d3ee");
    expect(faviconSvg).toContain("#020617");
    expect(faviconSvg).toContain("brand-glyph");
  });
});
