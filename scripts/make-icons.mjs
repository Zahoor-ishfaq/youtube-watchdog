/**
 * Renders the Watchdog mark to the PNG sizes Chrome needs, plus a greyed
 * "paused" variant shown on the toolbar button when monitoring is off.
 *
 *   npm run icons
 *
 * logo.svg carries the full mark; logo-small.svg drops the nose so the face
 * still reads at 16px.
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ICON_DIR = resolve('public/icons');
const SIZES = [16, 32, 48, 128];

const full = readFileSync(resolve(ICON_DIR, 'logo.svg'), 'utf8');
const small = readFileSync(resolve(ICON_DIR, 'logo-small.svg'), 'utf8');

const greyed = (svg) => svg.replaceAll('#6366f1', '#9ca3af').replaceAll('#4338ca', '#6b7280');

async function render(source, size, file) {
  await sharp(Buffer.from(source), { density: 512 })
    .resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(ICON_DIR, file));
}

console.log('Rendering icons →', ICON_DIR);
for (const size of SIZES) {
  const source = size <= 16 ? small : full;
  await render(source, size, `icon${size}.png`);
  await render(greyed(source), size, `icon${size}-off.png`);
  console.log(`  icon${size}.png + icon${size}-off.png`);
}
console.log('Done.');
