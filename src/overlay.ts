/**
 * The reminder card injected into the YouTube page. Rendered inside a closed
 * shadow root so YouTube's styles cannot bleed in and ours cannot bleed out.
 * All content is set through textContent — never innerHTML.
 */
import overlayCss from '../public/overlay.css';
import { createLogo } from './lib/logo';
import type { Quote } from './lib/quotes';
import { SNOOZE_MINUTES } from './lib/settings';

export const OVERLAY_HOST_ID = 'watchdog-overlay-host';
const MAX_TOPIC_IN_BUTTON = 32;

/** Why the card is being shown, which changes its wording. */
export type OverlayReason = 'off-topic' | 'shorts';

export interface OverlayOptions {
  reason: OverlayReason;
  topic: string;
  videoTitle: string;
  channelName: string;
  quote: Quote;
  onBack: () => void;
  onContinue: () => void;
  onSnooze: () => void;
  onAllowChannel: () => void;
}

let host: HTMLElement | null = null;
let keyHandler: ((event: KeyboardEvent) => void) | null = null;
let fullscreenHandler: (() => void) | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return b;
}

/** Where the overlay must live so it stays visible in YouTube's fullscreen mode. */
function overlayParent(): Element {
  return document.fullscreenElement ?? document.body;
}

export function isOverlayOpen(): boolean {
  return host !== null && host.isConnected;
}

export function removeOverlay(): void {
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
  }
  if (fullscreenHandler) {
    document.removeEventListener('fullscreenchange', fullscreenHandler);
    fullscreenHandler = null;
  }
  host?.remove();
  host = null;
  // Defensive: clear any host left behind by a previous script instance (extension reload).
  document.getElementById(OVERLAY_HOST_ID)?.remove();
}

export function showOverlay(options: OverlayOptions): void {
  removeOverlay();

  host = el('div');
  host.id = OVERLAY_HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = el('style');
  style.textContent = overlayCss;

  const backdrop = el('div', 'wd-backdrop');
  const card = el('div', 'wd-card');
  // Focus the dialog itself, not a button: YouTube users reach for Space out of
  // habit, and a focused "Back to…" button would turn that into a navigation.
  card.tabIndex = -1;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'wd-title');

  // Brand row
  const brand = el('div', 'wd-brand');
  brand.append(createLogo(22), el('span', undefined, 'Watchdog'));

  const isShorts = options.reason === 'shorts';

  const title = el('h2', 'wd-title', isShorts ? 'Shorts can wait' : 'This looks off-topic');
  title.id = 'wd-title';

  const body = el('p', 'wd-body');
  if (isShorts) {
    body.append(
      document.createTextNode("You're focusing on "),
      el('strong', undefined, options.topic),
      document.createTextNode('. Shorts are built to keep you scrolling.'),
    );
  } else {
    body.append(
      document.createTextNode("You're focusing on "),
      el('strong', undefined, options.topic),
      document.createTextNode(". This video doesn't seem related to that."),
    );
  }

  // Now-playing chip
  const video = el('div', 'wd-video');
  video.append(
    el('span', 'wd-video-label', isShorts ? 'Now playing · Short' : 'Now playing'),
    el('span', 'wd-video-title', options.videoTitle || 'Untitled'),
  );
  video.title = options.videoTitle;

  // Quote
  const figure = el('figure', 'wd-quote');
  const quote = el('blockquote', undefined, `“${options.quote.text}”`);
  figure.append(quote, el('figcaption', undefined, options.quote.author));

  // Actions
  const shortTopic = options.topic.length > MAX_TOPIC_IN_BUTTON
    ? `${options.topic.slice(0, MAX_TOPIC_IN_BUTTON - 1).trimEnd()}…`
    : options.topic;
  const backBtn = button('wd-btn wd-btn-primary', `Back to ${shortTopic}`, options.onBack);
  backBtn.title = `Search YouTube for "${options.topic}"`;
  const continueBtn = button('wd-btn wd-btn-secondary', 'Continue anyway', options.onContinue);
  const actions = el('div', 'wd-actions');
  actions.append(backBtn, continueBtn);

  // Footer links
  const footer = el('div', 'wd-footer');
  footer.append(button('wd-link', `Snooze ${SNOOZE_MINUTES} min`, options.onSnooze));
  if (options.channelName && !isShorts) {
    footer.append(el('span', 'wd-sep', '·'));
    const allow = button('wd-link', 'Allow this channel', options.onAllowChannel);
    allow.title = `Never flag videos from ${options.channelName}`;
    footer.append(allow);
  }
  const hint = el('span', 'wd-hint');
  hint.append(el('kbd', 'wd-kbd', 'Esc'), document.createTextNode('to continue'));
  footer.append(hint);

  card.append(brand, title, body, video, figure, actions, footer);
  backdrop.append(card);
  shadow.append(style, backdrop);

  // Keep YouTube's keyboard shortcuts (space, k, f, …) from firing while the card is open.
  host.addEventListener('keydown', (event) => event.stopPropagation());
  keyHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      options.onContinue();
    }
  };
  document.addEventListener('keydown', keyHandler, true);

  fullscreenHandler = () => {
    if (host && host.parentElement !== overlayParent()) overlayParent().appendChild(host);
  };
  document.addEventListener('fullscreenchange', fullscreenHandler);

  overlayParent().appendChild(host);
  card.focus({ preventScroll: true });
}
