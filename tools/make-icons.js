'use strict';
/* Turns data/Messages.png into the app identity assets:
 *   public/logo.png     512px original, transparent background
 *   public/favicon.ico  multi-size icon (PNG-compressed entries, Vista+)
 *   public/apple-touch-icon.png 180px, opaque dark tile
 * Run: node tools/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'Messages.png');
const OUT = path.join(ROOT, 'public');

/* ---------------- PNG decode (8-bit RGBA, non-interlaced) ---------------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8;
  let ihdr = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0), h: data.readUInt32BE(4),
        depth: data[8], color: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr) throw new Error('missing IHDR');
  if (ihdr.depth !== 8 || ihdr.color !== 6 || ihdr.interlace !== 0) {
    throw new Error(`unsupported PNG: depth=${ihdr.depth} color=${ihdr.color} interlace=${ihdr.interlace}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { w, h } = ihdr;
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.from(line);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      switch (filter) {
        case 0: break;
        case 1: cur[x] = (cur[x] + a) & 0xff; break;
        case 2: cur[x] = (cur[x] + b) & 0xff; break;
        case 3: cur[x] = (cur[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          cur[x] = (cur[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, data: out };
}

/* ---------------- PNG encode ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* The exported source keeps a ghost of its checkerboard backdrop: ~48k pixels
 * carry alpha 2..20 with a neutral gray colour. Averaged into a 32px icon they
 * turn into a dirty halo, so drop the neutral low-alpha speckle first. */
function cleanHalo(src) {
  const { data } = src;
  let removed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (a <= 28 && chroma <= 12) { data[i + 3] = 0; removed++; }
  }
  return removed;
}

/* ---------------- high quality area-average downscale ---------------- */
function resize(src, size) {
  const { w, h, data } = src;
  const scale = w / size;
  const out = Buffer.alloc(size * size * 4);
  for (let oy = 0; oy < size; oy++) {
    const y0 = oy * scale;
    const y1 = Math.min(h, y0 + scale);
    const sy0 = Math.floor(y0), sy1 = Math.ceil(y1);
    for (let ox = 0; ox < size; ox++) {
      const x0 = ox * scale;
      const x1 = Math.min(w, x0 + scale);
      const sx0 = Math.floor(x0), sx1 = Math.ceil(x1);
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = sx0; sx < sx1; sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const wt = wx * wy;
          const i = (sy * w + sx) * 4;
          const al = data[i + 3] / 255;
          // premultiply so transparent pixels never darken the edges
          r += data[i] * al * wt;
          g += data[i + 1] * al * wt;
          b += data[i + 2] * al * wt;
          a += data[i + 3] * wt;
          wsum += wt;
        }
      }
      const o = (oy * size + ox) * 4;
      const alSum = a / 255;
      out[o] = alSum > 0 ? Math.round(r / alSum) : 0;
      out[o + 1] = alSum > 0 ? Math.round(g / alSum) : 0;
      out[o + 2] = alSum > 0 ? Math.round(b / alSum) : 0;
      out[o + 3] = Math.round(a / wsum);
    }
  }
  return { w: size, h: size, data: out };
}

/* ---------------- opaque tile (apple-touch-icon / pinned shortcut) ------- */
function tile(src, size, bg) {
  const small = resize(src, size);
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    const a = small.data[o + 3] / 255;
    out[o] = Math.round(small.data[o] * a + bg[0] * (1 - a));
    out[o + 1] = Math.round(small.data[o + 1] * a + bg[1] * (1 - a));
    out[o + 2] = Math.round(small.data[o + 2] * a + bg[2] * (1 - a));
    out[o + 3] = 255;
  }
  return { w: size, h: size, data: out };
}

/* ---------------- ICO container ---------------- */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += img.png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

/* ---------------- run ---------------- */
const src = decodePng(fs.readFileSync(SRC));
console.log(`source ${src.w}x${src.h}`);
let corner = 0;
for (const [x, y] of [[0, 0], [src.w - 1, 0], [0, src.h - 1], [src.w - 1, src.h - 1]]) {
  corner = Math.max(corner, src.data[(y * src.w + x) * 4 + 3]);
}
console.log(`corner alpha max = ${corner} (0 means transparent background)`);
console.log(`removed ${cleanHalo(src)} ghost-backdrop pixels`);

// Re-encode instead of copying: the ghost backdrop must go from the in-app logo
// too, otherwise it shows as a faint grid on the dark theme.
fs.writeFileSync(path.join(OUT, 'logo.png'), encodePng(src.w, src.h, src.data));

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = icoSizes.map((size) => ({ size, png: encodePng(size, size, resize(src, size).data) }));
fs.writeFileSync(path.join(OUT, 'favicon.ico'), buildIco(images));
console.log(`favicon.ico  ${icoSizes.join('/')}  ${fs.statSync(path.join(OUT, 'favicon.ico')).size} bytes`);

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), encodePng(size, size, resize(src, size).data));
}

const touch = tile(src, 180, [18, 22, 30]);
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), encodePng(180, 180, touch.data));
console.log(`apple-touch-icon.png 180x180  ${fs.statSync(path.join(OUT, 'apple-touch-icon.png')).size} bytes`);
console.log(`logo.png ${fs.statSync(path.join(OUT, 'logo.png')).size} bytes`);
console.log('icon-192.png / icon-512.png written (manifest)');
