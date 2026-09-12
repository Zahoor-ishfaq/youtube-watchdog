import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMotivationalQuote, isSuitableQuote, QUOTES } from '../src/lib/quotes';
import bundled from '../data/quotes.json';

describe('the bundled quote collection', () => {
  it('ships exactly 100 quotes', () => {
    assert.equal(bundled.length, 100);
    assert.equal(QUOTES.length, 100);
  });

  it('has no duplicates', () => {
    const seen = new Set(bundled.map((q) => q.text));
    assert.equal(seen.size, bundled.length);
  });

  it('attributes every quote to a named author', () => {
    for (const q of bundled) {
      assert.ok(q.author.trim().length > 0, `missing author: ${q.text}`);
      assert.ok(!/^(unknown|anonymous)$/i.test(q.author.trim()), `unattributed: ${q.text}`);
    }
  });

  it('keeps every quote short enough for the card and right in tone', () => {
    for (const q of bundled) {
      assert.ok(isSuitableQuote(q.text), `unsuitable quote: ${q.text}`);
    }
  });
});

describe('getMotivationalQuote', () => {
  it('returns a quote from the bundled collection', () => {
    const quote = getMotivationalQuote();
    assert.ok(bundled.some((q) => q.text === quote.text && q.author === quote.author));
  });

  it('never returns the same quote twice in a row', () => {
    const first = getMotivationalQuote(() => 0.5);
    const second = getMotivationalQuote(() => 0.5);
    assert.notEqual(first.text, second.text);
  });

  it('reaches the whole collection, not just part of it', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(getMotivationalQuote().text);
    assert.equal(seen.size, QUOTES.length);
  });

  it('stays in range at the extremes of the random source', () => {
    for (const value of [0, 0.999999, 1]) {
      const quote = getMotivationalQuote(() => value);
      assert.ok(quote.text.length > 0);
      assert.ok(QUOTES.some((q) => q.text === quote.text));
    }
  });
});

describe('isSuitableQuote', () => {
  it('rejects the bleak quote that prompted dropping the quotes API', () => {
    assert.equal(
      isSuitableQuote("The saddest aspect of life is that there is no one on earth whose happiness is such that he won't sometimes wish he were dead rather than alive."),
      false,
    );
  });

  it('rejects themes that do not belong in a study reminder', () => {
    assert.equal(isSuitableQuote('Life is a tragedy for those who feel.'), false);
    assert.equal(isSuitableQuote('Revenge is a dish best served cold.'), false);
  });

  it('matches whole words only, so ordinary quotes survive', () => {
    // "using" contains "sin", "audience" contains "die", "toward" contains "war".
    assert.equal(isSuitableQuote('Keep using what you learn in front of an audience, working toward mastery.'), true);
    assert.equal(isSuitableQuote('The secret of getting ahead is getting started.'), true);
  });

  it('rejects fragments and over-long quotes', () => {
    assert.equal(isSuitableQuote('Go.'), false);
    assert.equal(isSuitableQuote('x'.repeat(300)), false);
  });
});
