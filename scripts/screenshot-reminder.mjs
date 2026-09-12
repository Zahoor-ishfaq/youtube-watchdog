/**
 * Captures docs/images/reminder.png: the real reminder card, on a real YouTube
 * page, produced by the real extension. Not a mockup.
 *
 *   npm run build && node scripts/screenshot-reminder.mjs
 *
 * Needs Chrome for Testing (see scripts/e2e.mjs for the install command).
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

const VIDEO = process.env.WATCHDOG_SHOT_VIDEO ?? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const OUT = resolve('docs/images/reminder.png');
const profile = mkdtempSync(join(tmpdir(), 'wd-shot-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', '--user-data-dir=' + profile,
  '--load-extension=' + resolve('dist'), '--enable-unsafe-extension-debugging',
  '--lang=en-US', '--mute-audio', '--hide-scrollbars',
  '--window-size=1280,720', '--force-device-scale-factor=2',
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

  let swSession = null;
  for (let i = 0; i < 60 && !swSession; i++) {
    const { targetInfos } = await send('Target.getTargets');
    for (const c of targetInfos.filter((t) => t.type === 'service_worker')) {
      const a = await send('Target.attachToTarget', { targetId: c.targetId, flatten: true });
      let name = '';
      try {
        const r = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true }, a.sessionId);
        name = r.result?.value ?? '';
      } catch {}
      if (name === 'Watchdog') { swSession = a.sessionId; break; }
      await send('Target.detachFromTarget', { sessionId: a.sessionId });
    }
    if (!swSession) await sleep(500);
  }
  if (!swSession) throw new Error('extension service worker never started');

  await send('Runtime.evaluate', {
    expression: "chrome.storage.local.set({focusTopic:'AWS certification',focusEnabled:true,sensitivity:'balanced',snoozeUntil:0,allowedChannels:[],flagShorts:true}).then(()=>1)",
    awaitPromise: true, returnByValue: true,
  }, swSession);

  const tab = await send('Target.createTarget', { url: VIDEO });
  const a = await send('Target.attachToTarget', { targetId: tab.targetId, flatten: true });
  const S = a.sessionId;
  await send('Runtime.enable', {}, S);
  await send('Page.enable', {}, S);
  const ev = async (expr) => {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, timeout: 30000 }, S);
      return r.exceptionDetails ? 'ERR' : r.result?.value;
    } catch { return 'FAIL'; }
  };

  for (let i = 0; i < 60; i++) { if ((await ev('document.readyState')) === 'complete') break; await sleep(500); }
  console.log('page:', await ev('document.title'));

  console.log('waiting for the reminder card…');
  let seen = false;
  for (let i = 0; i < 150 && !seen; i++) {
    seen = (await ev("!!document.getElementById('watchdog-overlay-host')")) === true;
    if (!seen) await sleep(1000);
  }
  if (!seen) throw new Error('the card never appeared');

  await sleep(1200); // let the entrance animation settle
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, S);
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('wrote', OUT);
} catch (e) {
  console.error('FAILED:', e.message);
  code = 1;
} finally {
  try { child.kill('SIGKILL'); } catch {}
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(code);
