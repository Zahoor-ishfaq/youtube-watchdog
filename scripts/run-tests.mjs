/**
 * Bundles test/*.test.ts with esbuild and runs them with Node's built-in test runner.
 *
 *   npm test
 */
import * as esbuild from 'esbuild';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const OUT_DIR = resolve('.test-dist');
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const entryPoints = globSync('test/**/*.test.ts');
if (entryPoints.length === 0) {
  console.error('No test files found under test/');
  process.exit(1);
}

await esbuild.build({
  entryPoints,
  outdir: OUT_DIR,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
});

const builtFiles = globSync('**/*.mjs', { cwd: OUT_DIR }).map((f) => resolve(OUT_DIR, f));
const result = spawnSync(process.execPath, ['--test', '--enable-source-maps', ...builtFiles], { stdio: 'inherit' });
rmSync(OUT_DIR, { recursive: true, force: true });
process.exit(result.status ?? 1);
