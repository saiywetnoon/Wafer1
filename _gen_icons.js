// Generates icon-192.png and icon-512.png (solid amber "roll" mark on dark) for
// the PWA manifest using Node's built-in zlib — no image library needed.
// Usage: node _gen_icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(size) {
  const BG = [31, 41, 55];      // gray-800
  const OUTER = [217, 119, 6];  // amber-600
  const INNER = [251, 191, 36]; // amber-400
  const raw = Buffer.alloc(size * (1 + size * 3));
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - half) ** 2 + (y - half) ** 2) / size; // 0..~0.707
      let col = BG;
      if (d <= 0.24) col = INNER;
      else if (d <= 0.44) col = OUTER;
      const o = row + 1 + x * 3;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor RGB
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
const out = path.join(__dirname);
[192, 512].forEach(function (s) {
  const file = path.join(out, 'icon-' + s + '.png');
  fs.writeFileSync(file, png(s));
  console.log('wrote ' + file + ' (' + fs.statSync(file).size + ' bytes)');
});