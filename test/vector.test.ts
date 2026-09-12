import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity } from '../src/lib/vector';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-12);
  });

  it('is 0 for orthogonal vectors', () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });

  it('is -1 for opposite vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 1], [-1, -1]) + 1) < 1e-12);
  });

  it('is scale invariant', () => {
    const a = [0.2, 0.5, 0.9];
    const b = a.map((x) => x * 7);
    assert.ok(Math.abs(cosineSimilarity(a, b) - 1) < 1e-12);
  });

  it('returns 0 for mismatched lengths or zero vectors', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
    assert.equal(cosineSimilarity([], []), 0);
  });

  it('accepts typed arrays', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([3, 2, 1]);
    const expected = (3 + 4 + 3) / (Math.sqrt(14) * Math.sqrt(14));
    assert.ok(Math.abs(cosineSimilarity(a, b) - expected) < 1e-6);
  });
});
