/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const { createCanvas } = require('canvas');
const pngToIco = require('png-to-ico').default;

const ROOT = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets');

const BG = '#141414';
const PURPLE = '#7c3aed';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function drawQ(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);

  // text
  ctx.fillStyle = PURPLE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // A clean sans-serif; fall back to system sans-serif.
  const fontPx = Math.round(size * 0.70);
  ctx.font = `700 ${fontPx}px "Segoe UI", Arial, sans-serif`;

  // Slight optical adjustment so it feels centered.
  ctx.fillText('Q', Math.round(size / 2), Math.round(size / 2) + Math.round(size * 0.02));

  return canvas;
}

async function main() {
  ensureDir(ASSETS_DIR);

  const png1024Path = path.join(ASSETS_DIR, 'icon.png');
  const png256Path = path.join(ASSETS_DIR, 'icon-256.png');
  const icoPath = path.join(ASSETS_DIR, 'icon.ico');

  fs.writeFileSync(png1024Path, drawQ(1024).toBuffer('image/png'));
  fs.writeFileSync(png256Path, drawQ(256).toBuffer('image/png'));

  // png-to-ico can take a PNG file path (it will resize to include 256/48/32/16).
  const icoBuf = await pngToIco(png256Path);
  fs.writeFileSync(icoPath, icoBuf);

  console.log('Generated:', path.relative(ROOT, png1024Path));
  console.log('Generated:', path.relative(ROOT, icoPath));
  console.log('Note: macOS .icns skipped (Windows-only repo).');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exitCode = 1;
});
