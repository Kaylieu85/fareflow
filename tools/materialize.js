#!/usr/bin/env node
/* Recreates FareFlow's binary assets (icons, banner, QR posters) from
 * tools/assets-b64.json at container start. The public git mirror carries
 * text instead of raw binaries (some git hosts reject large binary blobs),
 * and this script puts the real files back before the server boots.
 * Runs as an idempotent no-op when the files already exist locally. */
const fs = require('fs');
const path = require('path');

const bundleFile = path.join(__dirname, 'assets-b64.json');
if (!fs.existsSync(bundleFile)) {
  console.log('materialize: no bundle found, skipping');
  process.exit(0);
}
const bundle = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
let n = 0;
for (const [rel, data] of Object.entries(bundle)) {
  const abs = path.join(__dirname, '..', rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(data, 'base64'));
  n++;
}
console.log(`materialize: wrote ${n} binary assets from bundle`);
