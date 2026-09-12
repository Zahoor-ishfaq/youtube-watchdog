/**
 * Content script for youtube.com. Detects which video is playing, asks the
 * service worker whether it matches the focus topic, and shows the reminder
 * card when it does not.
 */
import type { CheckVideoRequest, CheckVideoResponse } from './lib/messages';
import type { Quote } from './lib/quotes';
import { normalizeChannel, sanitizeText, sanitizeTopic } from './lib/sanitize';
import {
  DEFAULT_SETTINGS,
  isSnoozed,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SNOOZE_MINUTES,
  type Settings,
} from './lib/settings';
import { isOverlayOpen, removeOverlay, showOverlay, type OverlayReason } from './overlay';

// ─── Tunables ────────────────────────────────────────────────────────────────

const CHECK_DEBOUNCE_MS = 600; // YouTube fires several navigation signals per page change
const TITLE_POLL_INTERVAL_MS = 250;
const TITLE_POLL_MAX_MS = 6000; // give the new title this long to appear after navigation
const PROMPT_COOLDOWN_MS = 90_000; // at most one reminder per 90s
const URL_POLL_INTERVAL_MS = 700; // catches Shorts swipes, which fire no navigation event

const TITLE_SELECTORS = [
  'ytd-watch-metadata h1 yt-formatted-string',
  'h1.ytd-watch-metadata yt-formatted-string',
  '#above-the-fold #title h1 yt-formatted-string',
  'h1.ytd-video-primary-info-renderer yt-formatted-string', // legacy layout
];

// Shorts use an entirely different player. Verified against the live DOM:
// the title is an <h1> and the channel sits in the reel channel bar.
const SHORTS_TITLE_SELECTORS = [
  '.ytShortsVideoTitleViewModelShortsVideoTitle',
  'yt-shorts-video-title-view-model',
  'ytd-reel-video-renderer h2 yt-formatted-string',
];

const SHORTS_CHANNEL_SELECTORS = [
  '.ytReelChannelBarViewModelChannelName a',
  'ytd-reel-player-header-renderer ytd-channel-name a',
  '#reel-player-header-container a[href^="/@"]',
];

const CHANNEL_SELECTORS = [
  'ytd-watch-metadata #owner ytd-channel-name a',
  'ytd-video-owner-renderer ytd-channel-name a',
  '#upload-info ytd-channel-name a',
  'ytd-video-owner-renderer #channel-name a',
];

// ─── State ───────────────────────────────────────────────────────────────────

let settings: Settings = DEFAULT_SETTINGS;
let evaluationToken = 0;
let debounceTimer: number | null = null;
let lastPromptAt = 0;
let previousVideoId: string | null = null;
let overlayVideoId: string | null = null;
let pausedByUs: HTMLVideoElement | null = null;

/** Videos already judged (relevant, dismissed, or allowed) — never re-prompted in this tab. */
const handledVideoIds = new Set<string>();
/** Titles we have seen per video id, used to tell a stale DOM title from a fresh one. */
const titleByVideoId = new Map<string, string>();

/** A tab left open for days should not accumulate state forever. */
const MAX_REMEMBERED_VIDEOS = 500;

function remember<T>(collection: Set<string> | Map<string, T>, key: string, value?: T): void {
  if (collection.size >= MAX_REMEMBERED_VIDEOS) {
    const oldest = collection.keys().next();
    if (!oldest.done) collection.delete(oldest.value);
  }
  if (collection instanceof Set) collection.add(key);
  else collection.set(key, value as T);
}

// ─── YouTube DOM helpers ─────────────────────────────────────────────────────

function isShortsPage(): boolean {
  return /^\/shorts\/[\w-]+/.test(location.pathname);
}

/** Identifies the current video, whether it is a normal watch page or a Short. */
function getVideoId(): string | null {
  if (isShortsPage()) return 'shorts:' + location.pathname.split('/')[2];
  if (location.pathname !== '/watch') return null;
  return new URLSearchParams(location.search).get('v');
}

function readTitle(): string {
  for (const selector of isShortsPage() ? SHORTS_TITLE_SELECTORS : TITLE_SELECTORS) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return sanitizeText(text);
  }
  // document.title is "(3) Video title - YouTube" — strip the notification count and suffix.
  const fromDocument = document.title
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .trim();
  return fromDocument.toLowerCase() === 'youtube' ? '' : sanitizeText(fromDocument);
}

function readChannel(): string {
  for (const selector of isShortsPage() ? SHORTS_CHANNEL_SELECTORS : CHANNEL_SELECTORS) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return sanitizeText(text);
  }
  return '';
}

function getPlayer(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('video.html5-main-video');
}

function pauseVideo(): void {
  const player = getPlayer();
  if (player && !player.paused) {
    player.pause();
    pausedByUs = player;
  }
}

function resumeVideo(): void {
  if (pausedByUs && pausedByUs.isConnected && pausedByUs.paused) {
    pausedByUs.play().catch(() => undefined);
  }
  pausedByUs = null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function waitUntilVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', onChange);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

/**
 * After an in-page navigation the DOM may still show the previous video's
 * title. Poll until a title appears that is not the previous video's title
 * (or is one we already know belongs to this video).
 */
async function waitForTitle(videoId: string, token: number): Promise<string> {
  const staleTitle = previousVideoId && previousVideoId !== videoId ? titleByVideoId.get(previousVideoId) : undefined;
  const knownTitle = titleByVideoId.get(videoId);
  const deadline = Date.now() + TITLE_POLL_MAX_MS;
  let latest = '';

  while (Date.now() < deadline) {
    if (token !== evaluationToken) return '';
    latest = readTitle();
    if (latest && (latest === knownTitle || latest !== staleTitle)) return latest;
    await sleep(TITLE_POLL_INTERVAL_MS);
  }
  return latest;
}

// ─── Core check ──────────────────────────────────────────────────────────────

function extensionAlive(): boolean {
  try {
    return typeof chrome.runtime?.id === 'string';
  } catch {
    return false;
  }
}

async function evaluate(): Promise<void> {
  const token = ++evaluationToken;
  const videoId = getVideoId();

  if (overlayVideoId && overlayVideoId !== videoId) closeOverlay(false);
  if (!videoId) return;
  const isNewVideo = previousVideoId !== videoId;

  try {
    if (!settings.focusEnabled || !settings.focusTopic || isSnoozed(settings)) return;
    if (handledVideoIds.has(videoId)) return;

    // A flagged Short needs no title: it is flagged on format, not content.
    const shortsFlagged = isShortsPage() && settings.flagShorts;
    const title = shortsFlagged ? readTitle() : await waitForTitle(videoId, token);
    if (token !== evaluationToken) return;
    if (!shortsFlagged && !title) return;
    if (title) remember(titleByVideoId, videoId, title);

    const channel = readChannel();
    if (channel && settings.allowedChannels.includes(normalizeChannel(channel))) {
      remember(handledVideoIds, videoId);
      return;
    }

    const cooldownLeft = PROMPT_COOLDOWN_MS - (Date.now() - lastPromptAt);
    if (cooldownLeft > 0) {
      scheduleEvaluate(cooldownLeft + 50); // come back once the cooldown expires
      return;
    }

    const topic = sanitizeTopic(settings.focusTopic);
    if (!topic || !extensionAlive()) return;

    // Shorts are flagged without scoring them. Their titles are routinely just
    // hashtags, so there is nothing meaningful for the model to judge, and this
    // also means no waiting for the model to load.
    if (shortsFlagged) {
      const quote = await requestQuote();
      if (token !== evaluationToken || !quote) return;
      remember(handledVideoIds, videoId);
      await present(token, videoId, 'shorts', topic, title, channel, quote);
      return;
    }

    const request: CheckVideoRequest = {
      type: 'CHECK_VIDEO',
      videoTitle: title,
      channelName: channel,
      userTopic: topic,
      sensitivity: settings.sensitivity,
    };
    const response = (await chrome.runtime.sendMessage(request)) as CheckVideoResponse | undefined;
    if (token !== evaluationToken || !response) return;

    remember(handledVideoIds, videoId);
    if (response.relevant) return;

    await present(token, videoId, 'off-topic', topic, title, channel, response.quote);
  } catch {
    // Service worker unavailable or extension reloaded — fail open, never block the user.
  } finally {
    if (isNewVideo && token === evaluationToken) previousVideoId = videoId;
  }
}

/** Fetches a quote for cases where no relevance check runs. */
async function requestQuote(): Promise<Quote | null> {
  try {
    const reply = (await chrome.runtime.sendMessage({ type: 'GET_QUOTE' })) as { quote?: Quote } | undefined;
    return reply?.quote ?? null;
  } catch {
    return null;
  }
}

async function present(
  token: number,
  videoId: string,
  reason: OverlayReason,
  topic: string,
  title: string,
  channel: string,
  quote: Quote,
): Promise<void> {
  // Don't interrupt a background tab; show the card when the user looks at it.
  await waitUntilVisible();
  if (token !== evaluationToken || getVideoId() !== videoId) return;

  lastPromptAt = Date.now();
  overlayVideoId = videoId;
  pauseVideo();
  showOverlay({
    reason,
    topic,
    videoTitle: title,
    channelName: channel,
    quote,
    onBack: () => {
      closeOverlay(false);
      location.assign(`https://www.youtube.com/results?search_query=${encodeURIComponent(topic)}`);
    },
    onContinue: () => closeOverlay(true),
    onSnooze: () => {
      closeOverlay(true);
      void saveSettings({ snoozeUntil: Date.now() + SNOOZE_MINUTES * 60_000 });
    },
    onAllowChannel: () => {
      closeOverlay(true);
      const normalized = normalizeChannel(channel);
      if (normalized && !settings.allowedChannels.includes(normalized)) {
        void saveSettings({ allowedChannels: [...settings.allowedChannels, normalized] });
      }
    },
  });
}

function closeOverlay(resume: boolean): void {
  removeOverlay();
  overlayVideoId = null;
  if (resume) resumeVideo();
  else pausedByUs = null;
}

function scheduleEvaluate(delay = CHECK_DEBOUNCE_MS): void {
  if (debounceTimer !== null) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    void evaluate();
  }, delay);
}

// ─── Settings sync ───────────────────────────────────────────────────────────

function applySettingsChange(next: Settings): void {
  const prev = settings;
  settings = next;

  const topicChanged = prev.focusTopic !== next.focusTopic;
  const sensitivityChanged = prev.sensitivity !== next.sensitivity;
  const turnedOff = prev.focusEnabled && !next.focusEnabled;
  const snoozed = !isSnoozed(prev) && isSnoozed(next);

  if (turnedOff || snoozed) {
    if (isOverlayOpen()) closeOverlay(true);
  }
  if (topicChanged || sensitivityChanged) {
    handledVideoIds.clear();
    lastPromptAt = 0;
    if (isOverlayOpen()) closeOverlay(true);
  }
  scheduleEvaluate();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  if (!extensionAlive()) return;
  try {
    settings = await loadSettings();
  } catch {
    return;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const merged: Record<string, unknown> = { ...settings };
    for (const [key, change] of Object.entries(changes)) merged[key] = change.newValue;
    applySettingsChange(normalizeSettings(merged));
  });

  // YouTube is a single-page app: these fire on in-page navigation without a reload.
  window.addEventListener('yt-navigate-finish', () => scheduleEvaluate());
  window.addEventListener('yt-page-data-updated', () => scheduleEvaluate());
  window.addEventListener('popstate', () => scheduleEvaluate());

  // Swiping to the next Short rewrites the URL via pushState, which fires
  // neither popstate nor a title change. A cheap string compare covers it.
  let watchedUrl = location.href;
  window.setInterval(() => {
    if (location.href !== watchedUrl) {
      watchedUrl = location.href;
      scheduleEvaluate();
    }
  }, URL_POLL_INTERVAL_MS);

  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(() => scheduleEvaluate()).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  scheduleEvaluate();
}

void init();
