/**
 * End-to-end check: loads the built extension into a real Chrome, opens a real
 * YouTube video, and verifies the reminder card actually appears.
 *
 *   npx @puppeteer/browsers install chrome@stable --path .browser
 *   npm run build
 *   npm run e2e
 *
 * Chrome 137+ refuses --load-extension, so this needs Chrome for Testing rather
 * than the installed Chrome. This test is what caught the two scoring bugs
 * described in docs/calibration.md, so it is worth re-running after any change
 * to the thresholds or the content script.
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
const EXT = resolve('dist');
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const profile = mkdtempSync(join(tmpdir(), 'wd-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', '--user-data-dir=' + profile,
  '--load-extension=' + EXT, '--enable-unsafe-extension-debugging',
  '--lang=en-US', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

const pending = new Map();
let nextId = 1;
let buf = Buffer.alloc(0);
const swLog = [];
const contexts = [];

child.stdio[4].on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  let i;
  while ((i = buf.indexOf(0)) !== -1) {
    const raw = buf.subarray(0, i).toString('utf8');
    buf = buf.subarray(i + 1);
    if (!raw) continue;
    let m;
    try { m = JSON.parse(raw); } catch { continue; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); continue; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || []).map((a) => (a.value !== undefined ? a.value : a.description || '')).join(' ');
      if (txt) swLog.push('[' + m.params.type + '] ' + txt);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      swLog.push('[exception] ' + String(d.exception?.description ?? d.text).split('\n')[0]);
    }
    if (m.method === 'Runtime.executionContextCreated') {
      contexts.push({ sessionId: m.sessionId, ...m.params.context });
    }
  }
});

const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
  const msg = sessionId ? { id, method, params, sessionId } : { id, method, params };
  child.stdio[3].write(JSON.stringify(msg) + '\0');
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
  await send('Runtime.enable', {}, swSession);

  const swEval = async (expr, timeout = 300000) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout }, swSession);
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).split('\n')[0]);
    return r.result?.value;
  };

  await swEval("chrome.storage.local.set({focusTopic:'AWS certification',focusEnabled:true,sensitivity:'balanced',snoozeUntil:0,allowedChannels:[]}).then(()=>1)");
  console.log('focus session saved, monitoring on');

  const tab = await send('Target.createTarget', { url: VIDEO });
  const yAttach = await send('Target.attachToTarget', { targetId: tab.targetId, flatten: true });
  const ySession = yAttach.sessionId;
  await send('Runtime.enable', {}, ySession);
  await send('Page.enable', {}, ySession);

  for (let i = 0; i < 60; i++) {
    const r = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, ySession).catch(() => null);
    if (r && String(r.result?.value).includes('watch?v=')) break;
    await sleep(500);
  }
  await sleep(4000);

  const pageContexts = contexts.filter((c) => c.sessionId === ySession);
  console.log('\nexecution contexts in the youtube tab:');
  for (const c of pageContexts) {
    console.log('  id=' + c.id, 'name=' + JSON.stringify(c.name), 'type=' + (c.auxData?.type ?? '?'), 'origin=' + String(c.origin).slice(0, 40));
  }

  const isolated = pageContexts.filter((c) => c.auxData?.type === 'isolated');
  console.log('\ncontent script isolated world present:', isolated.length > 0 ? 'YES' : 'NO  <-- content script never injected');

  if (isolated.length > 0) {
    // Several isolated worlds can exist; ours is the one named after the extension.
    const ctx = isolated.find((c) => c.name === 'Watchdog') ?? isolated[isolated.length - 1];
    const inWorld = async (expr, timeout = 300000) => {
      const r = await send('Runtime.evaluate', { expression: expr, contextId: ctx.id, awaitPromise: true, returnByValue: true, timeout }, ySession);
      if (r.exceptionDetails) return 'THREW: ' + String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).split('\n')[0];
      return r.result?.value;
    };
    console.log('  extension id visible in world:', await inWorld('typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id ? "yes" : "no"'));
    console.log('  settings the world can read  :', await inWorld("chrome.storage.local.get(['focusTopic','focusEnabled']).then(o=>JSON.stringify(o))"));

    console.log('\nsending a CHECK_VIDEO message the way the content script does...');
    const t0 = Date.now();
    const resp = await inWorld("chrome.runtime.sendMessage({type:'CHECK_VIDEO',videoTitle:'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',channelName:'Rick Astley',userTopic:'AWS certification',sensitivity:'balanced'}).then(r=>JSON.stringify(r)).catch(e=>'REJECTED: '+e.message)");
    console.log('  response after ' + ((Date.now() - t0) / 1000).toFixed(1) + 's:', String(resp).slice(0, 300));
  }

  console.log('\nwaiting up to 90s for the card to appear on its own...');
  let seen = false;
  for (let i = 0; i < 90 && !seen; i++) {
    const r = await send('Runtime.evaluate', { expression: "!!document.getElementById('watchdog-overlay-host')", returnByValue: true }, ySession).catch(() => null);
    seen = r?.result?.value === true;
    if (!seen) await sleep(1000);
  }
  console.log('card appeared:', seen ? 'YES' : 'NO');
  if (!seen) code = 1;

  console.log('\nservice worker log:');
  console.log(swLog.length ? '  ' + swLog.slice(-12).join('\n  ') : '  (nothing logged)');
} catch (e) {
  console.error('FAILED:', e.message);
  console.log('service worker log:\n  ' + swLog.slice(-12).join('\n  '));
  code = 1;
} finally {
  try { child.kill('SIGKILL'); } catch {}
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(code);
