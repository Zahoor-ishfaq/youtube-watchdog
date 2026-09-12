/**
 * Service worker: owns the embedding model and answers relevance checks from
 * the content script. Everything here fails open — on any error the video is
 * reported as relevant so the user is never blocked by a bug.
 */
import { isRequest, type CheckVideoRequest, type CheckVideoResponse } from './lib/messages';
import { getMotivationalQuote } from './lib/quotes';
import { normalizeChannel, sanitizeText, sanitizeTopic } from './lib/sanitize';
import { CHANNEL_THRESHOLD, loadSettings, THRESHOLDS, type Settings } from './lib/settings';
import { getModelStatus, isVideoRelevant, warmUpModel } from './lib/similarity';

const ICON_ACTIVE = { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png' };
const ICON_PAUSED = { 16: 'icons/icon16-off.png', 32: 'icons/icon32-off.png', 48: 'icons/icon48-off.png' };

function isMonitoring(settings: Settings): boolean {
  return settings.focusEnabled && settings.focusTopic.length > 0;
}

async function reflectSettings(settings: Settings): Promise<void> {
  const active = isMonitoring(settings);
  await chrome.action.setIcon({ path: active ? ICON_ACTIVE : ICON_PAUSED });
  await chrome.action.setTitle({
    title: active ? `Watchdog — focusing on "${settings.focusTopic}"` : 'Watchdog — not monitoring',
  });
  if (active) warmUpModel().catch(() => undefined); // non-fatal; loads lazily on first check
}

// Runs on every service-worker start (install, browser start, wake-up after idle).
loadSettings().then(reflectSettings).catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => {
  loadSettings().then(reflectSettings).catch(() => undefined);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('focusEnabled' in changes || 'focusTopic' in changes) {
    loadSettings().then(reflectSettings).catch(() => undefined);
  }
});

async function handleCheckVideo(message: CheckVideoRequest): Promise<CheckVideoResponse> {
  // Inputs come from a content script running inside youtube.com — treat as untrusted.
  const title = sanitizeText(message.videoTitle);
  const channel = normalizeChannel(message.channelName);
  const topic = sanitizeTopic(message.userTopic);
  const threshold = THRESHOLDS[message.sensitivity] ?? THRESHOLDS.balanced;

  if (!title || !topic) return { relevant: true, score: null };

  try {
    const { relevant, result } = await isVideoRelevant(topic, title, channel, threshold, CHANNEL_THRESHOLD);
    const score = result?.score ?? null;
    console.debug(
      `[Watchdog] "${title}" vs "${topic}" → title ${result?.titleScore.toFixed(3)}, ` +
        `channel ${result?.channelScore?.toFixed(3) ?? 'n/a'} (bar ${CHANNEL_THRESHOLD}), ` +
        `lexical ${result?.lexicalMatch}, threshold ${threshold} → ${relevant ? 'relevant' : 'off-topic'}`,
    );
    if (relevant || score === null) return { relevant: true, score };

    return { relevant: false, score, quote: getMotivationalQuote() };
  } catch (error) {
    console.debug('[Watchdog] check failed, failing open:', error);
    return { relevant: true, score: null };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isRequest(message)) return false;

  switch (message.type) {
    case 'GET_STATUS':
      sendResponse(getModelStatus());
      return false;

    case 'GET_QUOTE':
      sendResponse({ quote: getMotivationalQuote() });
      return false;

    case 'WARM_UP':
      warmUpModel().catch(() => undefined);
      sendResponse(getModelStatus());
      return false;

    case 'CHECK_VIDEO': {
      // Only content scripts on YouTube may ask for checks.
      const fromYouTube = sender.tab !== undefined && (sender.url ?? '').startsWith('https://www.youtube.com/');
      if (!fromYouTube) {
        sendResponse({ relevant: true, score: null } satisfies CheckVideoResponse);
        return false;
      }
      handleCheckVideo(message).then(sendResponse);
      return true; // keep the channel open for the async response
    }
  }
});
