import * as esbuild from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const watch = process.argv.includes('--watch');

// onnxruntime-web must find its WebAssembly binary next to background.js. The
// service worker cannot load remote code, so we ship the binary inside dist/.
// Keep this name in sync with ORT_WASM_FILE in src/lib/similarity.ts.
const ORT_WASM_FILE = 'ort-wasm-simd-threaded.jsep.wasm';
const ORT_WASM_SRC = resolve('node_modules/onnxruntime-web/dist', ORT_WASM_FILE);

const shared = {
  bundle: true,
  target: ['chrome124'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  legalComments: 'none',
};

const builds = [
  {
    // Service worker: ES module so `import.meta.url` resolves to the extension origin,
    // which lets onnxruntime-web use its embedded loader and locate the .wasm locally.
    ...shared,
    entryPoints: ['src/background.ts'],
    outfile: 'dist/background.js',
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  {
    // Content script: must be a classic script (IIFE), not an ES module.
    ...shared,
    entryPoints: ['src/content.ts'],
    outfile: 'dist/content.js',
    format: 'iife',
    loader: { '.css': 'text' }, // overlay.css is inlined into the shadow root
  },
  {
    ...shared,
    entryPoints: ['src/popup.ts'],
    outfile: 'dist/popup.js',
    format: 'iife',
  },
];

function copyStatic() {
  mkdirSync('dist/icons', { recursive: true });
  copyFileSync('manifest.json', 'dist/manifest.json');
  copyFileSync('public/popup.html', 'dist/popup.html');
  copyFileSync('public/popup.css', 'dist/popup.css');
  cpSync('public/icons', 'dist/icons', { recursive: true });

  if (!existsSync(ORT_WASM_SRC)) {
    throw new Error(`Missing ${ORT_WASM_SRC}. Run "npm install" first.`);
  }
  copyFileSync(ORT_WASM_SRC, resolve('dist', ORT_WASM_FILE));
  const mb = (statSync(ORT_WASM_SRC).size / 1024 / 1024).toFixed(1);
  console.log(`Copied ${ORT_WASM_FILE} (${mb} MB) into dist/`);
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  copyStatic();
  console.log('Watching for changes… (static files are copied once; re-run after editing them)');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  copyStatic();
  console.log('Build complete → dist/');
}
