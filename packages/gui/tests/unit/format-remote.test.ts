import { describe, expect, it } from 'vitest';
import {
  sanitizeRemoteUrl,
  shortenPath,
  shortenRemoteUrl,
} from '../../src/renderer/lib/format-remote';

describe('shortenPath', () => {
  it('replaces /Users/<name> with ~', () => {
    expect(shortenPath('/Users/michael/Documents/vault')).toBe('~/Documents/vault');
  });

  it('replaces /home/<name> with ~', () => {
    expect(shortenPath('/home/michael/vault')).toBe('~/vault');
  });

  it('leaves other paths unchanged', () => {
    expect(shortenPath('/etc/something')).toBe('/etc/something');
  });

  it('handles nested paths correctly', () => {
    expect(shortenPath('/Users/alice/a/b/c')).toBe('~/a/b/c');
  });
});

describe('sanitizeRemoteUrl', () => {
  it('strips credentials from https url', () => {
    expect(sanitizeRemoteUrl('https://token123@github.com/user/repo.git')).toBe(
      'https://github.com/user/repo.git',
    );
  });

  it('strips user:password credentials', () => {
    expect(sanitizeRemoteUrl('https://user:pass@github.com/user/repo.git')).toBe(
      'https://github.com/user/repo.git',
    );
  });

  it('leaves clean https url unchanged', () => {
    expect(sanitizeRemoteUrl('https://github.com/user/repo.git')).toBe(
      'https://github.com/user/repo.git',
    );
  });

  it('leaves ssh url unchanged', () => {
    expect(sanitizeRemoteUrl('git@github.com:user/repo.git')).toBe('git@github.com:user/repo.git');
  });
});

describe('shortenRemoteUrl', () => {
  it('strips https:// protocol and .git suffix', () => {
    expect(shortenRemoteUrl('https://github.com/user/repo.git')).toBe('github.com/user/repo');
  });

  it('strips credentials and .git', () => {
    expect(shortenRemoteUrl('https://token@github.com/user/repo.git')).toBe('github.com/user/repo');
  });

  it('converts git@host:path ssh format', () => {
    expect(shortenRemoteUrl('git@github.com:user/repo.git')).toBe('github.com/user/repo');
  });

  it('works without .git suffix', () => {
    expect(shortenRemoteUrl('https://github.com/user/repo')).toBe('github.com/user/repo');
  });
});
