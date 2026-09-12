/**
 * Sweeps the title threshold and the separate, higher channel bar, so both are
 * chosen from data. Run after changing the model, the prompt, or the cases:
 *
 *   node scripts/sweep.mjs
 */
import { pipeline } from '@huggingface/transformers';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CASES } from './calibration-cases.mjs';

const outDir = mkdtempSync(join(tmpdir(), 'wd-sweep-'));
let isLexicalMatch;
let cosineSimilarity;
try {
  await build({
    entryPoints: ['src/lib/lexical.ts', 'src/lib/vector.ts'],
    outdir: outDir, outExtension: { '.js': '.mjs' },
    bundle: true, format: 'esm', platform: 'node', target: ['node20'], logLevel: 'warning',
  });
  ({ isLexicalMatch } = await import(pathToFileURL(join(outDir, 'lexical.mjs'))));
  ({ cosineSimilarity } = await import(pathToFileURL(join(outDir, 'vector.mjs'))));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

const topicPrompt = (t) => `studying ${t}`;

console.log('Loading model…');
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
  const tv = await embed(topicPrompt(topic));
  rows.push({
    topic, title, channel, expected,
    titleScore: cosineSimilarity(tv, await embed(title)),
    channelScore: cosineSimilarity(tv, await embed(channel)),
    lexical: isLexicalMatch(topic, title) || isLexicalMatch(topic, channel),
  });
}

const on = rows.filter((r) => r.expected === 'on');
const off = rows.filter((r) => r.expected === 'off');

const stat = (arr, key) => {
  const v = arr.map((r) => r[key]).sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return `min=${v[0].toFixed(3)} p50=${q(0.5).toFixed(3)} p90=${q(0.9).toFixed(3)} max=${v[v.length - 1].toFixed(3)}`;
};
console.log(`\non-topic  title   ${stat(on, 'titleScore')}`);
console.log(`off-topic title   ${stat(off, 'titleScore')}`);
console.log(`on-topic  channel ${stat(on, 'channelScore')}`);
console.log(`off-topic channel ${stat(off, 'channelScore')}`);

// Old rule: max(title, channel). New rule: title >= t OR channel >= c.
const oldRule = (r, t) => r.lexical || Math.max(r.titleScore, r.channelScore) >= t;
const newRule = (r, t, c) => r.lexical || r.titleScore >= t || r.channelScore >= c;

function score(rule) {
  const fa = on.filter((r) => !rule(r)).length;
  const ms = off.filter((r) => rule(r)).length;
  return { fa, ms, cost: fa * 2 + ms };
}

console.log('\n--- old rule: max(title, channel) >= t ---');
console.log('   t     falseAlarms  misses  cost');
for (const t of [0.10, 0.14, 0.18, 0.22, 0.26, 0.30]) {
  const s = score((r) => oldRule(r, t));
  console.log(`  ${t.toFixed(2)}      ${String(s.fa).padStart(2)}/${on.length}      ${String(s.ms).padStart(2)}/${off.length}     ${s.cost}`);
}

console.log('\n--- new rule: title >= t OR channel >= c ---');
let best = null;
for (let t = 0.06; t <= 0.42001; t += 0.01) {
  for (const c of [0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 1.01]) {
    const s = score((r) => newRule(r, t, c));
    if (!best || s.cost < best.cost || (s.cost === best.cost && c < best.c)) best = { t, c, ...s };
  }
}
console.log(`  best: title>=${best.t.toFixed(2)} OR channel>=${best.c === 1.01 ? 'never' : best.c.toFixed(2)}  → falseAlarms=${best.fa}/${on.length} misses=${best.ms}/${off.length} cost=${best.cost}`);

console.log('\n  cost grid (rows = title threshold, cols = channel bar)');
const cols = [0.30, 0.35, 0.40, 0.45, 0.50];
console.log('   t   ' + cols.map((c) => c.toFixed(2).padStart(6)).join(''));
for (let t = 0.08; t <= 0.30001; t += 0.02) {
  const cells = cols.map((c) => {
    const s = score((r) => newRule(r, t, c));
    return `${s.fa}/${s.ms}`.padStart(6);
  });
  console.log(`  ${t.toFixed(2)} ` + cells.join(''));
}

console.log('\n  (cells are falseAlarms/misses)');

const chosen = { relaxed: 0.10, balanced: 0.16, strict: 0.24 };
console.log('\n--- candidate shipped thresholds, channel bar 0.40 ---');
for (const [name, t] of Object.entries(chosen)) {
  const s = score((r) => newRule(r, t, 0.40));
  console.log(`  ${name.padEnd(9)} t=${t.toFixed(2)}  falseAlarms=${s.fa}/${on.length}  misses=${s.ms}/${off.length}`);
  for (const r of on.filter((r) => !newRule(r, t, 0.40))) console.log(`     false alarm: ${r.topic} -> ${r.title} (${r.titleScore.toFixed(3)})`);
  for (const r of off.filter((r) => newRule(r, t, 0.40))) console.log(`     miss:        ${r.topic} -> ${r.title} (title ${r.titleScore.toFixed(3)}, ch ${r.channelScore.toFixed(3)}, lex ${r.lexical})`);
}
