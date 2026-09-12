/**
 * Persistent settings shared by the popup, content script and service worker.
 * Stored in chrome.storage.local only.
 */

export type Sensitivity = 'relaxed' | 'balanced' | 'strict';

export interface Settings {
  /** What the user is studying. Empty string = not configured. */
  focusTopic: string;
  /** Master switch. */
  focusEnabled: boolean;
  /** How aggressively to flag videos. */
  sensitivity: Sensitivity;
  /** Epoch ms until which reminders are paused. 0 = not snoozed. */
  snoozeUntil: number;
  /** Normalized (lower-cased) channel names the user marked as always OK. */
  allowedChannels: string[];
  /**
   * Treat every YouTube Short as off-topic without scoring it. Shorts titles
   * are frequently just hashtags ("#bts"), so there is nothing for the model to
   * judge, and the format exists to be scrolled indefinitely. Turn this off to
   * score Shorts the same way as normal videos.
   */
  flagShorts: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  focusTopic: '',
  focusEnabled: false,
  sensitivity: 'balanced',
  snoozeUntil: 0,
  allowedChannels: [],
  flagShorts: true,
};

/**
 * Title-similarity threshold per sensitivity. A video whose title scores below
 * the threshold is treated as off-topic unless another signal rescues it.
 *
 * Measured, not guessed: `npm run calibrate` scores 42 labelled cases with the
 * real model. See docs/calibration.md.
 */
export const THRESHOLDS: Record<Sensitivity, number> = {
  relaxed: 0.12,
  balanced: 0.15,
  strict: 0.24,
};

/**
 * The channel name is a weaker, noisier signal than the title, so it gets its
 * own much higher bar and can only ever rescue a video, never condemn one.
 *
 * On the calibration set, off-topic channel names top out at 0.21 ("Emma
 * Chamberlain" against "studying machine learning"), while a genuine rescue
 * such as "AWS Training and Certification" scores 0.89. Anything from 0.25 to
 * 0.50 separates those cleanly; 0.35 sits in the middle with margin on both
 * sides.
 */
export const CHANNEL_THRESHOLD = 0.35;

export const SNOOZE_MINUTES = 15;

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

function isSensitivity(value: unknown): value is Sensitivity {
  return value === 'relaxed' || value === 'balanced' || value === 'strict';
}

/** Coerces whatever is in storage into a well-formed Settings object. */
export function normalizeSettings(raw: Record<string, unknown> | undefined): Settings {
  const r = raw ?? {};
  return {
    focusTopic: typeof r.focusTopic === 'string' ? r.focusTopic : DEFAULT_SETTINGS.focusTopic,
    focusEnabled: typeof r.focusEnabled === 'boolean' ? r.focusEnabled : DEFAULT_SETTINGS.focusEnabled,
    sensitivity: isSensitivity(r.sensitivity) ? r.sensitivity : DEFAULT_SETTINGS.sensitivity,
    snoozeUntil: typeof r.snoozeUntil === 'number' && Number.isFinite(r.snoozeUntil) ? r.snoozeUntil : 0,
    allowedChannels: Array.isArray(r.allowedChannels)
      ? r.allowedChannels.filter((c): c is string => typeof c === 'string').slice(0, 200)
      : [],
    flagShorts: typeof r.flagShorts === 'boolean' ? r.flagShorts : DEFAULT_SETTINGS.flagShorts,
  };
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEYS);
  return normalizeSettings(raw);
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export function isSnoozed(settings: Settings, now = Date.now()): boolean {
  return settings.snoozeUntil > now;
}
