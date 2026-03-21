import { describe, expect, it } from 'vitest';
import { t } from '../../src/renderer/i18n';

describe('t()', () => {
  it('returns the translation for a known key', () => {
    expect(t('app.name')).toBe('syncthis');
  });

  it('returns the translation for a status key', () => {
    expect(t('status.healthy')).toBe('Healthy');
  });

  it('interpolates a single variable', () => {
    expect(t('time.minutes_ago', { n: 5 })).toBe('5m ago');
  });

  it('interpolates multiple variables', () => {
    expect(t('conflict.image_dimensions', { w: 800, h: 600 })).toBe('800 × 600');
  });

  it('falls back to the key for an unknown key', () => {
    expect(t('nonexistent.key' as Parameters<typeof t>[0])).toBe('nonexistent.key');
  });
});
