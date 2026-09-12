/**
 * Input sanitizers. Every string that originates outside the extension
 * (YouTube DOM, quote API, user input) passes through one of these before it
 * is stored, sent between contexts, or rendered.
 *
 * Rendering always uses `textContent`, never `innerHTML`, so these functions
 * do NOT HTML-encode. Encoding here would show literal "&#x27;" in the UI.
 * They strip tags, control characters and excess whitespace, and cap length.
 */

const MAX_TEXT_LENGTH = 500;
const MAX_TOPIC_LENGTH = 100;
const MAX_CHANNEL_LENGTH = 100;

const HTML_TAGS = /<[^>]*>?/g;
const WHITESPACE = /\s+/g;

/** Removes C0/C1 control characters and DEL. Tab, LF and CR are kept for whitespace collapsing. */
function stripControlChars(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    const isC0 = code < 32 && code !== 9 && code !== 10 && code !== 13;
    const isDelOrC1 = code >= 127 && code <= 159;
    if (!isC0 && !isDelOrC1) out += ch;
  }
  return out;
}

function baseClean(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return stripControlChars(input.replace(HTML_TAGS, ' '))
    .replace(WHITESPACE, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** Free text such as a video title or quote. */
export function sanitizeText(input: unknown): string {
  return baseClean(input, MAX_TEXT_LENGTH);
}

/**
 * The user's focus topic. Letters and digits in any script, plus a small set
 * of punctuation that appears in real topics ("C++", "CI/CD", "Node.js").
 */
export function sanitizeTopic(input: unknown): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.replace(/[^\p{L}\p{N}\s\-_.,:+#&/()']/gu, ' ');
  return baseClean(cleaned, MAX_TOPIC_LENGTH);
}

/** Channel names are compared case-insensitively for the allow list. */
export function normalizeChannel(input: unknown): string {
  return baseClean(input, MAX_CHANNEL_LENGTH).toLowerCase();
}
