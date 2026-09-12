/**
 * Captures docs/images/popup.png: the real popup, rendered by the real
 * extension, in three states side by side.
 *
 *   npm run build && node scripts/screenshot-popup.mjs
 *
 * Needs Chrome for Testing (see scripts/e2e.mjs for the install command).
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

function findChrome() {
  const root = resolve('.browser/chrome');
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root)) {
    for (const exe of ['chrome-win64/chrome.exe', 'chrome-linux64/chrome', 'chrome-mac-x64/Chromium.app/Contents/MacOS/Chromium']) {
      const candidate = join(root, dir, exe);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const CHROME = findChrome();
if (!CHROME) {
  console.error('Chrome for Testing not found. Run:');
  console.error('  npx @puppeteer/browsers install chrome@stable --path .browser');
  process.exit(1);
}

const STATES = [
  { name: 'fresh', settings: { focusTopic: '', focusEnabled: false, sensitivity: 'balanced', snoozeUntil: 0, allowedChannels: [], flagShorts: true } },
  { name: 'active', settings: { focusTopic: 'AWS certification', focusEnabled: true, sensitivity: 'balanced', snoozeUntil: 0, allowedChannels: ['freecodecamp.org', 'aws training'], flagShorts: true } },
  { name: 'snoozed', settings: { focusTopic: 'Organic chemistry', focusEnabled: true, sensitivity: 'strict', snoozeUntil: Date.now() + 9 * 60_000, allowedChannels: [], flagShorts: false } },
];

const profile = mkdtempSync(join(tmpdir(), 'wd-pop-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', '--user-data-dir=' + profile,
  '--load-extension=' + resolve('dist'), '--enable-unsafe-extension-debugging',
  '--lang=en-US', '--mute-audio', '--hide-scrollbars',
  '--window-size=340,600', '--force-device-scale-factor=2',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

const pending = new Map();
let nextId = 1;
let buf = Buffer.alloc(0);
child.stdio[4].on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  let i;
  while ((i = buf.indexOf(0)) !== -1) {
    const raw = buf.subarray(0, i).toString('utf8');
    buf = buf.subarray(i + 1);
    if (!raw) continue;
    let m; try { m = JSON.parse(raw); } catch { continue; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
  child.stdio[3].write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + '\0');
});

let code = 0;
try {
  await send('Target.setDiscoverTargets', { discover: true });

  let sw = null;
  let swSession = null;
  for (let i = 0; i < 60 && !sw; i++) {
    const { targetInfos } = await send('Target.getTargets');
    for (const c of targetInfos.filter((t) => t.type === 'service_worker')) {
      const a = await send('Target.attachToTarget', { targetId: c.targetId, flatten: true });
      let name = '';
      try {
        const r = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true }, a.sessionId);
        name = r.result?.value ?? '';
      } catch {}
      if (name === 'Watchdog') { sw = c; swSession = a.sessionId; break; }
      await send('Target.detachFromTarget', { sessionId: a.sessionId });
    }
    if (!sw) await sleep(500);
  }
  if (!sw) throw new Error('extension service worker never started');
  const extId = new URL(sw.url).host;

  // Get the model to "Ready" so the status row shows the steady state rather
  // than a download in progress. The worker cannot message its own listener,
  // so drive it by enabling monitoring and watching a popup's status row.
  console.log('loading the model so the status row shows the steady state…');
  await send('Runtime.evaluate', {
    expression: `chrome.storage.local.set(${JSON.stringify(STATES[1].settings)}).then(()=>1)`,
    awaitPromise: true, returnByValue: true,
  }, swSession);

  {
    const t = await send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
    const a = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    await send('Runtime.enable', {}, a.sessionId);
    for (let i = 0; i < 300; i++) {
      const r = await send('Runtime.evaluate', {
        expression: "(document.getElementById('model-sub')||{}).textContent||''",
        returnByValue: true,
      }, a.sessionId).catch(() => null);
      const text = r?.result?.value ?? '';
      if (/^Ready/.test(text)) { console.log('  model:', text); break; }
      if (i % 15 === 0 && text) console.log('  …', text);
      await sleep(1000);
    }
    await send('Target.closeTarget', { targetId: t.targetId });
  }

  const shots = [];
  for (const state of STATES) {
    await send('Runtime.evaluate', {
      expression: `chrome.storage.local.set(${JSON.stringify(state.settings)}).then(()=>1)`,
      awaitPromise: true, returnByValue: true,
    }, swSession);

    const t = await send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
    const a = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    await send('Runtime.enable', {}, a.sessionId);
    await sleep(2200);

    const metrics = await send('Runtime.evaluate', {
      expression: "JSON.stringify({w:Math.ceil(document.querySelector('.app').getBoundingClientRect().width),h:Math.ceil(document.querySelector('.app').getBoundingClientRect().height)})",
      returnByValue: true,
    }, a.sessionId);
    const { w, h } = JSON.parse(metrics.result.value);

    // The popup is taller than the headless viewport, so size the viewport to
    // the content before capturing or the panel comes out clipped.
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 2, mobile: false,
    }, a.sessionId);
    await sleep(400);

    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: w, height: h, scale: 2 },
    }, a.sessionId);
    shots.push({ name: state.name, buf: Buffer.from(shot.data, 'base64'), h });
    console.log(`  captured ${state.name} (${w}x${h})`);
    await send('Target.closeTarget', { targetId: t.targetId });
  }

  // Compose the three panels onto one dark board. Kept at 900px wide:
  // larger exports crossed a ~100 KB ceiling that blocked the image from
  // loading on some networks.
  const pad = 18;
  const metas = await Promise.all(shots.map((s) => sharp(s.buf).metadata()));
  const width = metas[0].width;
  const height = Math.max(...metas.map((m) => m.height));
  const board = {
    create: {
      width: pad + (width + pad) * shots.length,
      height: height + pad * 2,
      channels: 4,
      background: '#0b0c10',
    },
  };
  const out = await sharp(board)
    .composite(shots.map((s, i) => ({ input: s.buf, left: pad + (width + pad) * i, top: pad })))
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  const resized = await sharp(out).resize({ width: 900 }).png({ compressionLevel: 9, palette: true }).toBuffer();
  writeFileSync(resolve('docs/images/popup.png'), resized);
  console.log('wrote docs/images/popup.png');
} catch (e) {
  console.error('FAILED:', e.message);
  code = 1;
} finally {
  try { child.kill('SIGKILL'); } catch {}
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(code);
