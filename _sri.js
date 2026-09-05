// _sri.js — print sha384 integrity hashes for the pinned CDN assets.
const https = require('https');
const crypto = require('crypto');
const urls = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://unpkg.com/lucide@1.34.0/dist/umd/lucide.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.min.js',
  'https://unpkg.com/@supabase/supabase-js@2.115.0/dist/umd/supabase.min.js'
];
let i = 0;
function next() {
  if (i >= urls.length) return;
  const u = urls[i++];
  https.get(u, { timeout: 25000 }, (r) => {
    const b = [];
    r.on('data', (c) => b.push(c));
    r.on('end', () => {
      const sha = crypto.createHash('sha384').update(Buffer.concat(b)).digest('base64');
      console.log(u + ' -> sha384-' + sha);
      next();
    });
  }).on('error', (e) => { console.log(u + ' ERR ' + e.message); next(); });
}
next();