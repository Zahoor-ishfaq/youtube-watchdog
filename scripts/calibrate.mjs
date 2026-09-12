/**
 * Validates the shipped relevance rule against labelled cases using the real
 * model, and reports how each sensitivity level performs.
 *
 *   npm run calibrate
 *
 * Downloads the model once (~23 MB). Re-run after changing the topic prompt,
 * the model, or the thresholds. Use scripts/sweep.mjs to re-derive thresholds.
 */
import { pipeline } from '@huggingface/transformers';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CASES } from './calibration-cases.mjs';

// Load the real modules so this measures shipped behaviour, not a copy of it.
const outDir = mkdtempSync(join(tmpdir(), 'watchdog-cal-'));
let isLexicalMatch;
let THRESHOLDS;
let CHANNEL_THRESHOLD;
let cosineSimilarity;
try {
  await build({
    entryPoints: ['src/lib/lexical.ts', 'src/lib/settings.ts', 'src/lib/vector.ts'],
    outdir: outDir, outExtension: { '.js': '.mjs' },
    bundle: true, format: 'esm', platform: 'node', target: ['node20'], logLevel: 'warning',
  });
  ({ isLexicalMatch } = await import(pathToFileURL(join(outDir, 'lexical.mjs'))));
  ({ THRESHOLDS, CHANNEL_THRESHOLD } = await import(pathToFileURL(join(outDir, 'settings.mjs'))));
  ({ cosineSimilarity } = await import(pathToFileURL(join(outDir, 'vector.mjs'))));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

// Keep in sync with topicPrompt() in src/lib/similarity.ts.
const topicPrompt = (topic) => `studying ${topic}`;

console.log('Loading Xenova/all-MiniLM-L6-v2 (first run downloads ~23 MB)…');
const extract = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });

const cache = new Map();
async function embed(text) {
  if (!cache.has(text)) {
    const out = await extract(text, { pooling: 'mean', normalize: true });
    cache.set(text, Array.from(out.data));
  }
  return cache.get(text);
}

const rows = [];
for (const [topic, title, channel, expected] of CASES) {
  const topicVec = await embed(topicPrompt(topic));
  rows.push({
    topic, title, channel, expected,
    titleScore: cosineSimilarity(topicVec, await embed(title)),
    channelScore: cosineSimilarity(topicVec, await embed(channel)),
    lexical: isLexicalMatch(topic, title) || isLexicalMatch(topic, channel),
  });
}

// The shipped rule, mirrored from isVideoRelevant().
const isRelevant = (r, threshold) =>
  r.lexical || r.titleScore >= threshold || r.channelScore >= CHANNEL_THRESHOLD;

rows.sort((a, b) => b.titleScore - a.titleScore);
console.log('\n title  chan   expect  rescue  topic -> title');
for (const r of rows) {
  const rescue = r.lexical ? 'lex' : r.channelScore >= CHANNEL_THRESHOLD ? 'chan' : '   ';
  console.log(
    `${r.titleScore.toFixed(3).padStart(6)} ${r.channelScore.toFixed(3).padStart(6)}  ${r.expected.padEnd(6)}  ${rescue.padEnd(6)}  ${r.topic} -> ${r.title.slice(0, 52)}`,
  );
}

const on = rows.filter((r) => r.expected === 'on');
const off = rows.filter((r) => r.expected === 'off');

console.log(`\nchannel bar ${CHANNEL_THRESHOLD}`);
console.log('\nsensitivity  threshold  false alarms  misses');
for (const [name, t] of Object.entries(THRESHOLDS)) {
  const fa = on.filter((r) => !isRelevant(r, t));
  const ms = off.filter((r) => isRelevant(r, t));
  console.log(`${name.padEnd(12)} ${t.toFixed(2).padStart(8)}   ${String(fa.length).padStart(2)}/${on.length}         ${String(ms.length).padStart(2)}/${off.length}`);
  for (const r of fa) console.log(`               false alarm: ${r.topic} -> ${r.title} (${r.titleScore.toFixed(3)})`);
  for (const r of ms) console.log(`               miss:        ${r.topic} -> ${r.title} (title ${r.titleScore.toFixed(3)}, channel ${r.channelScore.toFixed(3)})`);
}
