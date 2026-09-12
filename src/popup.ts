/**
 * Extension popup: set the focus topic, sensitivity and on/off switch, and
 * see whether the on-device model is ready.
 */
import type { ModelStatus, Request } from './lib/messages';
import { sanitizeTopic } from './lib/sanitize';
import {
  isSnoozed,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type Sensitivity,
  type Settings,
} from './lib/settings';

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const topicInput = $<HTMLInputElement>('topic-input');
const saveBtn = $<HTMLButtonElement>('save-btn');
const statusEl = $<HTMLParagraphElement>('status');
const statusPill = $<HTMLSpanElement>('status-pill');
const toggle = $<HTMLInputElement>('focus-toggle');
const shortsToggle = $<HTMLInputElement>('shorts-toggle');
const monitorSub = $<HTMLSpanElement>('monitor-sub');
const snoozeRow = $<HTMLDivElement>('snooze-row');
const snoozeSub = $<HTMLSpanElement>('snooze-sub');
const resumeBtn = $<HTMLButtonElement>('resume-btn');
const allowedRow = $<HTMLDivElement>('allowed-row');
const allowedSub = $<HTMLSpanElement>('allowed-sub');
const clearAllowedBtn = $<HTMLButtonElement>('clear-allowed-btn');
const modelSub = $<HTMLSpanElement>('model-sub');
const modelDot = $<HTMLSpanElement>('model-dot');
const sensitivityHint = $<HTMLSpanElement>('sensitivity-hint');
const segButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.seg[data-sensitivity]'));

const SENSITIVITY_HINTS: Record<Sensitivity, string> = {
  relaxed: 'Fewer reminders',
  balanced: 'Recommended',
  strict: 'Flags more videos',
};

let settings: Settings;
let selectedSensitivity: Sensitivity = 'balanced';
let statusTimer: number | null = null;
let modelPollTimer: number | null = null;

// ─── Rendering ───────────────────────────────────────────────────────────────

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function render(): void {
  const hasTopic = settings.focusTopic.length > 0;
  const active = settings.focusEnabled && hasTopic;
  const snoozed = active && isSnoozed(settings);

  if (document.activeElement !== topicInput) topicInput.value = settings.focusTopic;
  toggle.checked = settings.focusEnabled;
  shortsToggle.checked = settings.flagShorts;
  saveBtn.textContent = active ? 'Update focus session' : 'Start focus session';

  statusPill.className = `pill ${snoozed ? 'pill-snoozed' : active ? 'pill-on' : 'pill-off'}`;
  statusPill.textContent = snoozed ? 'Snoozed' : active ? 'Active' : 'Off';

  monitorSub.textContent = active
    ? `Focusing on “${settings.focusTopic}”`
    : hasTopic
      ? 'Off'
      : 'Set a topic to start';

  snoozeRow.hidden = !snoozed;
  if (snoozed) snoozeSub.textContent = `Reminders resume at ${formatTime(settings.snoozeUntil)}`;

  const allowedCount = settings.allowedChannels.length;
  allowedRow.hidden = allowedCount === 0;
  allowedSub.textContent = `${allowedCount} channel${allowedCount === 1 ? '' : 's'} never flagged`;

  selectedSensitivity = settings.sensitivity;
  renderSensitivity();
}

function renderSensitivity(): void {
  for (const button of segButtons) {
    const checked = button.dataset.sensitivity === selectedSensitivity;
    button.setAttribute('aria-checked', String(checked));
  }
  sensitivityHint.textContent = SENSITIVITY_HINTS[selectedSensitivity];
}

function renderModel(status: ModelStatus | undefined): void {
  modelDot.className = 'dot';
  if (!status) {
    modelSub.textContent = 'Unavailable';
    return;
  }
  switch (status.state) {
    case 'ready':
      modelDot.classList.add('ready');
      modelSub.textContent = 'Ready · all-MiniLM-L6-v2';
      break;
    case 'loading':
      modelDot.classList.add('loading');
      modelSub.textContent = status.progress > 0
        ? `Downloading once (23 MB) · ${status.progress}%`
        : 'Preparing…';
      break;
    case 'error':
      modelDot.classList.add('error');
      modelSub.textContent = 'Could not load — retries automatically';
      break;
    default:
      modelSub.textContent = settings.focusEnabled ? 'Starting…' : 'Loads when monitoring starts';
  }
}

function showStatus(message: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = message; // textContent only — never innerHTML
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 2800);
}

// ─── Service worker calls ────────────────────────────────────────────────────

async function send<T>(request: Request): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(request)) as T;
  } catch {
    return undefined;
  }
}

async function refreshModelStatus(): Promise<void> {
  const status = await send<ModelStatus>({ type: 'GET_STATUS' });
  renderModel(status);

  const keepPolling = status?.state === 'loading' || (status?.state === 'idle' && settings.focusEnabled);
  if (modelPollTimer !== null) window.clearTimeout(modelPollTimer);
  modelPollTimer = keepPolling ? window.setTimeout(refreshModelStatus, 600) : null;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function saveTopic(): Promise<void> {
  const topic = sanitizeTopic(topicInput.value);
  if (!topic) {
    showStatus('Enter what you want to focus on.', 'error');
    topicInput.focus();
    return;
  }
  await saveSettings({ focusTopic: topic, focusEnabled: true, sensitivity: selectedSensitivity, snoozeUntil: 0 });
  topicInput.value = topic;
  showStatus('Session started. Watchdog is monitoring YouTube.', 'success');
  void send({ type: 'WARM_UP' }).then(() => refreshModelStatus());
}

saveBtn.addEventListener('click', () => void saveTopic());
topicInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void saveTopic();
});

for (const button of segButtons) {
  button.addEventListener('click', () => {
    const value = button.dataset.sensitivity as Sensitivity | undefined;
    if (!value || value === selectedSensitivity) return;
    selectedSensitivity = value;
    renderSensitivity();
    if (settings.focusTopic) {
      void saveSettings({ sensitivity: value }).then(() =>
        showStatus(`Sensitivity set to ${value}.`, 'success'),
      );
    }
  });
}

toggle.addEventListener('change', () => {
  if (toggle.checked && !settings.focusTopic) {
    toggle.checked = false;
    showStatus('Set a topic first.', 'error');
    topicInput.focus();
    return;
  }
  void saveSettings({ focusEnabled: toggle.checked, snoozeUntil: 0 }).then(() => {
    showStatus(toggle.checked ? 'Monitoring on.' : 'Monitoring off.', toggle.checked ? 'success' : 'info');
    if (toggle.checked) void send({ type: 'WARM_UP' }).then(() => refreshModelStatus());
  });
});

shortsToggle.addEventListener('change', () => {
  void saveSettings({ flagShorts: shortsToggle.checked }).then(() =>
    showStatus(
      shortsToggle.checked ? 'Shorts will always be flagged.' : 'Shorts are scored like any video.',
      'success',
    ),
  );
});

resumeBtn.addEventListener('click', () => {
  void saveSettings({ snoozeUntil: 0 }).then(() => showStatus('Reminders resumed.', 'success'));
});

clearAllowedBtn.addEventListener('click', () => {
  void saveSettings({ allowedChannels: [] }).then(() => showStatus('Allowed channels cleared.', 'success'));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const merged: Record<string, unknown> = { ...settings };
  for (const [key, change] of Object.entries(changes)) merged[key] = change.newValue;
  settings = normalizeSettings(merged);
  render();
});

// ─── Init ────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  settings = await loadSettings();
  render();
  await refreshModelStatus();
  if (!settings.focusTopic) topicInput.focus();
}

void init();
