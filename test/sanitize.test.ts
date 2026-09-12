import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChannel, sanitizeText, sanitizeTopic } from '../src/lib/sanitize';

describe('sanitizeText', () => {
  it('returns an empty string for non-strings', () => {
    assert.equal(sanitizeText(undefined), '');
    assert.equal(sanitizeText(null), '');
    assert.equal(sanitizeText(42), '');
    assert.equal(sanitizeText({ q: 'x' }), '');
  });

  it('strips HTML tags but keeps their text', () => {
    assert.equal(sanitizeText('<b>Bold</b> and <script>alert(1)</script>'), 'Bold and alert(1)');
    assert.equal(sanitizeText('unclosed <img src=x onerror=alert(1)'), 'unclosed');
  });

  it('does not HTML-encode, because rendering uses textContent', () => {
    assert.equal(sanitizeText(`It's "done" & dusted`), `It's "done" & dusted`);
  });

  it('removes control characters and collapses whitespace', () => {
    const nul = String.fromCharCode(0);
    const bell = String.fromCharCode(7);
    const del = String.fromCharCode(127);
    assert.equal(sanitizeText(`a${nul}b${bell}c${del}d`), 'abcd');
    assert.equal(sanitizeText('  many \n\n  spaces\t here  '), 'many spaces here');
  });

  it('keeps non-ASCII text', () => {
    assert.equal(sanitizeText('日本語のタイトル – Español'), '日本語のタイトル – Español');
  });

  it('caps length at 500 characters', () => {
    assert.equal(sanitizeText('x'.repeat(1000)).length, 500);
  });
});

describe('sanitizeTopic', () => {
  it('keeps real-world topics intact', () => {
    assert.equal(sanitizeTopic('AWS Certification'), 'AWS Certification');
    assert.equal(sanitizeTopic('C++ & Rust (systems)'), 'C++ & Rust (systems)');
    assert.equal(sanitizeTopic('CI/CD, Node.js: v22'), 'CI/CD, Node.js: v22');
    assert.equal(sanitizeTopic("Bachelor's thesis"), "Bachelor's thesis");
    assert.equal(sanitizeTopic('Español B2'), 'Español B2');
  });

  it('removes markup and dangerous characters', () => {
    assert.equal(sanitizeTopic('<script>alert(1)</script>math'), 'script alert(1) /script math');
    assert.ok(!sanitizeTopic('a<b>c"d`e').includes('<'));
    assert.ok(!sanitizeTopic('a<b>c"d`e').includes('"'));
    assert.ok(!sanitizeTopic('a<b>c"d`e').includes('`'));
  });

  it('caps length at 100 characters', () => {
    assert.equal(sanitizeTopic('a'.repeat(300)).length, 100);
  });

  it('returns an empty string for blank or non-string input', () => {
    assert.equal(sanitizeTopic('   '), '');
    assert.equal(sanitizeTopic('!!!'), '');
    assert.equal(sanitizeTopic(null), '');
  });
});

describe('normalizeChannel', () => {
  it('lower-cases and trims', () => {
    assert.equal(normalizeChannel('  FreeCodeCamp.org  '), 'freecodecamp.org');
  });

  it('strips tags', () => {
    assert.equal(normalizeChannel('<b>AWS</b> Training'), 'aws training');
  });
});
