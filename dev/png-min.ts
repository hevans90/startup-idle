/**
 * Minimal PNG read/write for the dev bakers.
 *
 * Deliberately not a dependency: the project ships no image library, and the
 * only PNGs these scripts touch are the tilesheets, which are all 8-bit RGBA
 * non-interlaced (verified across all 128 landscape frames). Anything else
 * throws rather than guessing.
 */
import { inflateSync, deflateSync } from "node:zlib";

export type Image = { w: number; h: number; px: Uint8Array }; // RGBA8, row-major

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buf: Buffer): Image {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
  let i = 8;
  let w = 0, h = 0, bitDepth = 0, colourType = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    i += 12 + len;
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colourType !== 6 && colourType !== 2)) {
    throw new Error(`unsupported PNG: depth ${bitDepth} colour ${colourType} interlace ${interlace}`);
  }
  const ch = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = new Uint8Array(raw.subarray(p, p + stride));
    p += stride;
    // undo the per-row filter (PNG spec §9.2)
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[x] = (line[x] + a) & 255; break;
        case 2: line[x] = (line[x] + b) & 255; break;
        case 3: line[x] = (line[x] + ((a + b) >> 1)) & 255; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          break;
        }
        default: throw new Error(`bad row filter ${filter}`);
      }
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch, d = (y * w + x) * 4;
      out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2];
      out[d + 3] = ch === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { w, h, px: out };
}

function crc32(b: Buffer): number {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tail]);
}

/** Filter 0 on every row: the sheets are small and this stays trivially correct. */
export function encodePng({ w, h, px }: Image): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    Buffer.from(px.subarray(y * w * 4, (y + 1) * w * 4)).copy(raw, y * (1 + w * 4) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Copy a rect from `src` into `dst`, skipping fully transparent source pixels. */
export function blit(
  dst: Image, src: Image,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number,
) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = ((sy + y) * src.w + (sx + x)) * 4;
      if (src.px[s + 3] === 0) continue;
      const d = ((dy + y) * dst.w + (dx + x)) * 4;
      dst.px[d] = src.px[s]; dst.px[d + 1] = src.px[s + 1];
      dst.px[d + 2] = src.px[s + 2]; dst.px[d + 3] = src.px[s + 3];
    }
  }
}
