/* Generates the PWA icons (PNG 192/512 + maskable + SVG) using ONLY Node's
   built-in zlib (no image library needed). Re-run with:
     node _gen_icons.js
   It writes icons/icon-192.png, icons/icon-512.png,
   icons/icon-maskable-512.png and icons/icon.svg. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- minimal PNG writer ---------- */
const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 6;        // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- icon painter ---------- */
const BG = [15, 23, 42, 255];        // dark slate  #0f172a
const AMBER = [245, 158, 11, 255];   //  #f59e0b
const AMBER_DARK = [120, 53, 15, 255]; // #78350f inner ring
function paintIcon(size, circleR) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let col = BG;
      if (d <= circleR) col = AMBER;
      if (d <= circleR * 0.42) col = AMBER_DARK;   // inner dot = the roll
      if (d >= circleR * 0.9 && d <= circleR * 0.98) col = [251, 191, 36, 255]; // highlight ring
      px[idx] = col[0]; px[idx + 1] = col[1]; px[idx + 2] = col[2]; px[idx + 3] = col[3];
    }
  }
  return px;
}
function roundRectMask(size, radius) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      px[idx + 3] = 255;
    }
  }
  return px;
}
/* Maskable icon: content must sit inside the 40% safe zone. */
function drawCircleOver(size, base, circleR) {
  const px = Buffer.from(base);
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      let col = BG;
      if (d <= circleR) col = AMBER;
      if (d <= circleR * 0.42) col = AMBER_DARK;
      if (d >= circleR * 0.9 && d <= circleR * 0.98) col = [251, 191, 36, 255];
      px[idx] = col[0]; px[idx + 1] = col[1]; px[idx + 2] = col[2]; px[idx + 3] = col[3];
    }
  }
  return px;
}

const outDir = path.join(__dirname, 'icons');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'icon-192.png'), encodePNG(192, 192, paintIcon(192, 192 * 0.40)));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), encodePNG(512, 512, paintIcon(512, 512 * 0.40)));
fs.writeFileSync(path.join(outDir, 'icon-maskable-512.png'), encodePNG(512, 512, drawCircleOver(512, roundRectMask(512, 0), 512 * 0.33)));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0f172a"/>
  <circle cx="256" cy="256" r="180" fill="#f59e0b"/>
  <circle cx="256" cy="256" r="76" fill="#78350f"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#fbbf24" stroke-width="16"/>
</svg>`;
fs.writeFileSync(path.join(outDir, 'icon.svg'), svg);

console.log('Icons written to ' + outDir);