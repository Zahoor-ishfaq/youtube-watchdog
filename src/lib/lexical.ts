/**
 * A lexical safety net that runs alongside the embedding model.
 *
 * Sentence embeddings are weak on acronyms and jargon: the model scores
 * "Python DSA" against "LeetCode 101: Two Sum explained" at 0.06, lower than
 * most genuinely unrelated videos. When the title literally repeats the words
 * of the topic, that is strong evidence of relevance no matter what the
 * embedding says, so we use it to suppress false alarms only. It can never
 * cause a reminder, only prevent one.
 */

/** Words too common to carry topic meaning. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'my', 'your',
  'how', 'what', 'why', 'is', 'are', 'this', 'that', 'full', 'video', 'tutorial',
  'guide', 'course', 'explained', 'beginners', 'beginner', 'part', 'vs', 'best',
  'top', 'new', 'learn', 'learning', 'study', 'studying', 'exam', 'prep', 'preparation',
]);

/** Fraction of the topic's content words that must appear in the title. */
export const LEXICAL_MATCH_RATIO = 0.5;

export function contentWords(input: string): string[] {
  const matches = input.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? [];
  return matches.filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Fraction of the topic's content words that also appear in the text.
 * Returns 0 when the topic has no content words to match on.
 */
export function lexicalOverlap(topic: string, text: string): number {
  const topicWords = new Set(contentWords(topic));
  if (topicWords.size === 0) return 0;
  const textWords = new Set(contentWords(text));
  let hits = 0;
  for (const word of topicWords) {
    if (textWords.has(word)) hits++;
  }
  return hits / topicWords.size;
}

/** True when the title repeats enough of the topic to be obviously related. */
export function isLexicalMatch(topic: string, text: string): boolean {
  return lexicalOverlap(topic, text) >= LEXICAL_MATCH_RATIO;
}
