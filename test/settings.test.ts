import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_THRESHOLD, DEFAULT_SETTINGS, isSnoozed, normalizeSettings, THRESHOLDS } from '../src/lib/settings';

describe('normalizeSettings', () => {
  it('returns defaults for empty storage', () => {
    assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
    assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const s = normalizeSettings({
      focusTopic: 'AWS',
      focusEnabled: true,
      sensitivity: 'strict',
      snoozeUntil: 123,
      allowedChannels: ['a', 'b'],
      flagShorts: false,
    });
    assert.deepEqual(s, {
      focusTopic: 'AWS',
      focusEnabled: true,
      sensitivity: 'strict',
      snoozeUntil: 123,
      allowedChannels: ['a', 'b'],
      flagShorts: false,
    });
  });

  it('coerces garbage back to defaults', () => {
    const s = normalizeSettings({
      focusTopic: 12,
      focusEnabled: 'yes',
      sensitivity: 'ultra',
      snoozeUntil: 'soon',
      allowedChannels: ['ok', 7, null],
    });
    assert.equal(s.focusTopic, '');
    assert.equal(s.focusEnabled, false);
    assert.equal(s.sensitivity, 'balanced');
    assert.equal(s.snoozeUntil, 0);
    assert.deepEqual(s.allowedChannels, ['ok']);
  });

  it('flags Shorts by default, including for settings saved before the option existed', () => {
    assert.equal(normalizeSettings({}).flagShorts, true);
    assert.equal(normalizeSettings({ focusTopic: 'AWS' }).flagShorts, true);
    assert.equal(normalizeSettings({ flagShorts: 'no' }).flagShorts, true);
    assert.equal(normalizeSettings({ flagShorts: false }).flagShorts, false);
  });
});

describe('isSnoozed', () => {
  it('is true only while snoozeUntil is in the future', () => {
    assert.equal(isSnoozed({ ...DEFAULT_SETTINGS, snoozeUntil: 2000 }, 1000), true);
    assert.equal(isSnoozed({ ...DEFAULT_SETTINGS, snoozeUntil: 2000 }, 2000), false);
    assert.equal(isSnoozed({ ...DEFAULT_SETTINGS, snoozeUntil: 0 }, 1000), false);
  });
});

describe('THRESHOLDS', () => {
  it('increase monotonically from relaxed to strict', () => {
    assert.ok(THRESHOLDS.relaxed < THRESHOLDS.balanced);
    assert.ok(THRESHOLDS.balanced < THRESHOLDS.strict);
  });

  it('sets the channel bar well above the strictest title threshold', () => {
    // The channel is a noisier signal, so it must clear a much higher bar.
    // Off-topic channel names reached 0.21 on the calibration set.
    assert.ok(CHANNEL_THRESHOLD > THRESHOLDS.strict);
    assert.ok(CHANNEL_THRESHOLD >= 0.25);
  });
});
