import { describe, expect, it } from 'vitest';
import { generateServiceName, slugify } from '../../src/daemon/service-name.js';

describe('slugify', () => {
  it('converts spaces to hyphens ("My Vault" → "my-vault")', () => {
    expect(slugify('My Vault')).toBe('my-vault');
  });

  it('replaces special characters with hyphens ("vault@home!" → "vault-home")', () => {
    expect(slugify('vault@home!')).toBe('vault-home');
  });

  it('collapses multiple consecutive hyphens ("a---b" → "a-b")', () => {
    expect(slugify('a---b')).toBe('a-b');
  });

  it('removes leading hyphens', () => {
    expect(slugify('-leading')).toBe('leading');
  });

  it('removes trailing hyphens', () => {
    expect(slugify('trailing-')).toBe('trailing');
  });

  it('removes both leading and trailing hyphens', () => {
    expect(slugify('-both-')).toBe('both');
  });

  it('lowercases all characters', () => {
    expect(slugify('UPPER')).toBe('upper');
  });

  it('preserves numbers', () => {
    expect(slugify('vault2home')).toBe('vault2home');
  });
});

describe('generateServiceName', () => {
  it('generates correct name for /home/user/vault-notes', () => {
    expect(generateServiceName('/home/user/vault-notes')).toBe('com.syncthis.user-vault-notes');
  });

  it('generates correct name for /home/user/work/notes', () => {
    expect(generateServiceName('/home/user/work/notes')).toBe('com.syncthis.work-notes');
  });

  it('slugifies path segments with spaces (/Users/mike/My Vault)', () => {
    expect(generateServiceName('/Users/mike/My Vault')).toBe('com.syncthis.mike-my-vault');
  });

  it('uses label when provided', () => {
    expect(generateServiceName('/any/path', 'my-vault')).toBe('com.syncthis.my-vault');
  });

  it('slugifies the label', () => {
    expect(generateServiceName('/any/path', 'My Vault')).toBe('com.syncthis.my-vault');
  });

  it('handles root path "/" (single segment)', () => {
    // resolve('/') → '/', split by sep filters empty → [], lastTwo = ''
    // slugify('') → '' → name is 'com.syncthis.'
    const result = generateServiceName('/');
    expect(result).toMatch(/^com\.syncthis\./);
  });

  it('handles a single-segment path like /notes', () => {
    const result = generateServiceName('/notes');
    expect(result).toBe('com.syncthis.notes');
  });

  it('handles very long path segments by slugifying them correctly', () => {
    const longName = 'a'.repeat(200);
    const result = generateServiceName(`/home/user/${longName}`);
    expect(result).toBe(`com.syncthis.user-${'a'.repeat(200)}`);
  });
});
