/**
 * Quotes are bundled, not fetched. Every quote ships in data/quotes.json, so
 * reminders work offline, appear instantly, and cost no network request.
 *
 * An earlier version pulled from a public quotations API. It was dropped
 * because that corpus is general-purpose: the first live response during
 * testing was Herodotus on wishing oneself dead, which is the last thing to
 * show someone who is struggling to concentrate. Curating locally makes the
 * tone guaranteed rather than probable.
 */
import { sanitizeText } from './sanitize';
import bundledQuotes from '../../data/quotes.json';

export interface Quote {
  text: string;
  author: string;
}

const MIN_QUOTE_LENGTH = 15;
const MAX_QUOTE_LENGTH = 220; // longer quotes crowd the card

/**
 * Themes that do not belong in a study reminder. The quote file is curated by
 * hand, so this exists to catch a bad addition later rather than to filter a
 * live feed. `npm test` asserts every bundled quote passes.
 *
 * Matching is whole-word, so "sin" does not match "using".
 */
const UNSUITABLE_WORDS = [
  'dead', 'death', 'deadly', 'die', 'dies', 'died', 'dying',
  'kill', 'kills', 'killed', 'killing', 'suicide', 'murder', 'corpse',
  'grave', 'graves', 'buried', 'funeral',
  'despair', 'hopeless', 'worthless', 'misery', 'miserable',
  'sorrow', 'sorrows', 'sorrowful', 'grief', 'agony', 'torment', 'anguish',
  'weep', 'weeping', 'wept', 'tragedy', 'tragic',
  'doom', 'doomed', 'curse', 'cursed', 'damned', 'damn',
  'hate', 'hatred', 'revenge', 'vengeance', 'enemy', 'enemies',
  'war', 'wars', 'blood', 'bloody', 'wound', 'wounded',
  'cruel', 'cruelty', 'evil', 'devil', 'satan', 'sin', 'sinner', 'sins',
  'drunk', 'drunken', 'whore',
];

const UNSUITABLE = new RegExp(`\\b(?:${UNSUITABLE_WORDS.join('|')})\\b`, 'i');

/** True when a quote is the right length and tone for a focus reminder. */
export function isSuitableQuote(text: string): boolean {
  if (text.length < MIN_QUOTE_LENGTH || text.length > MAX_QUOTE_LENGTH) return false;
  return !UNSUITABLE.test(text);
}

export const QUOTES: readonly Quote[] = bundledQuotes
  .map((q) => ({ text: sanitizeText(q.text), author: sanitizeText(q.author) }))
  .filter((q) => q.text.length > 0 && q.author.length > 0);

let lastIndex = -1;

/**
 * A random quote, never the same one twice in a row.
 *
 * `random` is injectable so tests can make the choice deterministic.
 */
export function getMotivationalQuote(random: () => number = Math.random): Quote {
  if (QUOTES.length === 0) {
    return { text: 'Back to work.', author: 'Watchdog' };
  }
  let index = Math.floor(random() * QUOTES.length);
  if (index < 0 || index >= QUOTES.length) index = 0;
  if (QUOTES.length > 1 && index === lastIndex) {
    index = (index + 1) % QUOTES.length;
  }
  lastIndex = index;
  return QUOTES[index] as Quote;
}
