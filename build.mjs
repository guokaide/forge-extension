import { build, context } from 'esbuild';
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

const isWatch = process.argv.includes('--watch');
const outdir = 'dist';

rmSync(outdir, { recursive: true, force: true });

// --- Icon generation ---
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function createIcon(size) {
  const R = 230, G = 126, B = 34;
  const radius = Math.round(size * 0.22);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const off = y * (1 + size * 4);
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 4;
      let inside = true;
      if (x < radius && y < radius) inside = Math.hypot(x - radius, y - radius) <= radius;
      else if (x >= size - radius && y < radius) inside = Math.hypot(x - (size - radius - 1), y - radius) <= radius;
      else if (x < radius && y >= size - radius) inside = Math.hypot(x - radius, y - (size - radius - 1)) <= radius;
      else if (x >= size - radius && y >= size - radius) inside = Math.hypot(x - (size - radius - 1), y - (size - radius - 1)) <= radius;
      raw[p] = R; raw[p + 1] = G; raw[p + 2] = B;
      raw[p + 3] = inside ? 255 : 0;
    }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(`${outdir}/icons`, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(`${outdir}/icons/icon${size}.png`, createIcon(size));
}

// --- Copy static files ---
const staticFiles = [
  ['manifest.json', `${outdir}/manifest.json`],
  ['src/popup/popup.html', `${outdir}/popup/popup.html`],
  ['src/popup/popup.css', `${outdir}/popup/popup.css`],
  ['src/blocked/blocked.html', `${outdir}/blocked/blocked.html`],
  ['src/blocked/blocked.css', `${outdir}/blocked/blocked.css`],
  ['src/options/options.html', `${outdir}/options/options.html`],
  ['src/options/options.css', `${outdir}/options/options.css`],
  ['src/dashboard/dashboard.html', `${outdir}/dashboard/dashboard.html`],
  ['src/dashboard/dashboard.css', `${outdir}/dashboard/dashboard.css`],
  ['src/newtab/newtab.html', `${outdir}/newtab/newtab.html`],
  ['src/newtab/newtab.css', `${outdir}/newtab/newtab.css`],
];

for (const [src, dest] of staticFiles) {
  const dir = dest.substring(0, dest.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  cpSync(src, dest);
}

// --- Bundle TypeScript ---
const options = {
  entryPoints: [
    'src/background.ts',
    'src/popup/popup.ts',
    'src/blocked/blocked.ts',
    'src/options/options.ts',
    'src/dashboard/dashboard.ts',
    'src/newtab/newtab.ts',
  ],
  bundle: true,
  outdir,
  outbase: 'src',
  format: 'iife',
  target: 'chrome120',
};

if (isWatch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching...');
} else {
  await build(options);
  console.log('Build complete.');
}
