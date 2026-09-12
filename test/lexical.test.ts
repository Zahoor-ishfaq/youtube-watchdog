import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contentWords, isLexicalMatch, lexicalOverlap } from '../src/lib/lexical';

describe('contentWords', () => {
  it('drops stop words and short words', () => {
    assert.deepEqual(contentWords('How to learn the AWS basics'), ['aws', 'basics']);
  });

  it('keeps technical tokens with symbols', () => {
    assert.deepEqual(contentWords('C++ and C# programming'), ['c++', 'programming']);
  });

  it('handles non-Latin scripts', () => {
    assert.deepEqual(contentWords('日本語 grammar'), ['日本語', 'grammar']);
  });

  it('returns an empty list for stop-word-only input', () => {
    assert.deepEqual(contentWords('how to study for the exam'), []);
  });
});

describe('lexicalOverlap', () => {
  it('is 1 when every topic word appears', () => {
    assert.equal(lexicalOverlap('Python DSA', 'Python DSA sheet day 4'), 1);
  });

  it('is a fraction on partial matches', () => {
    assert.equal(lexicalOverlap('organic chemistry', 'Chemistry lecture 12'), 0.5);
  });

  it('is 0 with no shared words', () => {
    assert.equal(lexicalOverlap('calculus', 'Lo-fi hip hop radio'), 0);
  });

  it('is 0 when the topic carries no content words', () => {
    assert.equal(lexicalOverlap('how to study', 'anything at all'), 0);
  });
});

describe('isLexicalMatch', () => {
  it('rescues jargon titles the embedding scores badly', () => {
    assert.equal(isLexicalMatch('Python DSA', 'Python DSA roadmap 2025'), true);
  });

  it('is case insensitive', () => {
    assert.equal(isLexicalMatch('AWS certification', 'aws certification bootcamp'), true);
  });

  it('does not fire on unrelated videos', () => {
    assert.equal(isLexicalMatch('machine learning', 'Gordon Ramsay makes the perfect steak'), false);
    assert.equal(isLexicalMatch('AWS certification', 'Liverpool vs Arsenal extended highlights'), false);
  });

  it('needs at least half the topic words, not just one', () => {
    assert.equal(isLexicalMatch('advanced organic chemistry lab', 'Chemistry of cooking'), false);
  });
});
