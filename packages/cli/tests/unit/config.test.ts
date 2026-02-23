import { writeFile as fsWriteFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BRANCH,
  DEFAULT_CRON,
  type SyncthisConfig,
  createDefaultConfig,
  loadConfig,
  mergeWithFlags,
  validateConfig,
  writeConfig,
} from '../../src/config.js';

const VALID_REMOTE = 'git@github.com:user/vault.git';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'syncthis-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('validateConfig', () => {
  it('accepts a valid config with cron', () => {
    const result = validateConfig({
      remote: VALID_REMOTE,
      branch: 'main',
      cron: '*/5 * * * *',
      interval: null,
    });
    expect(result.remote).toBe(VALID_REMOTE);
    expect(result.branch).toBe('main');
    expect(result.cron).toBe('*/5 * * * *');
    expect(result.interval).toBeNull();
  });

  it('accepts a valid config with interval', () => {
    const result = validateConfig({
      remote: VALID_REMOTE,
      branch: 'main',
      cron: null,
      interval: 60,
    });
    expect(result.interval).toBe(60);
    expect(result.cron).toBeNull();
  });

  it('defaults branch to "main" when omitted', () => {
    const result = validateConfig({ remote: VALID_REMOTE, cron: '*/5 * * * *' });
    expect(result.branch).toBe(DEFAULT_BRANCH);
  });

  it('accepts interval exactly at the minimum of 10', () => {
    const result = validateConfig({ remote: VALID_REMOTE, cron: null, interval: 10 });
    expect(result.interval).toBe(10);
  });

  it('throws when remote is missing', () => {
    expect(() => validateConfig({ cron: '*/5 * * * *' })).toThrow(/"remote"/);
  });

  it('throws when remote is empty string', () => {
    expect(() => validateConfig({ remote: '', cron: '*/5 * * * *' })).toThrow(/"remote"/);
  });

  it('throws when remote is whitespace only', () => {
    expect(() => validateConfig({ remote: '   ', cron: '*/5 * * * *' })).toThrow(/"remote"/);
  });

  it('throws when branch is empty string', () => {
    expect(() => validateConfig({ remote: VALID_REMOTE, branch: '', cron: '*/5 * * * *' })).toThrow(
      /"branch"/,
    );
  });

  it('throws when cron and interval are both set', () => {
    expect(() =>
      validateConfig({ remote: VALID_REMOTE, cron: '*/5 * * * *', interval: 60 }),
    ).toThrow(/mutually exclusive/);
  });

  it('throws when neither cron nor interval is set', () => {
    expect(() => validateConfig({ remote: VALID_REMOTE, cron: null, interval: null })).toThrow(
      /one of "cron" or "interval"/,
    );
  });

  it('throws when neither cron nor interval field is present', () => {
    expect(() => validateConfig({ remote: VALID_REMOTE })).toThrow(/one of "cron" or "interval"/);
  });

  it('throws on an invalid cron expression', () => {
    expect(() => validateConfig({ remote: VALID_REMOTE, cron: 'not-a-cron-expression' })).toThrow(
      /Invalid cron expression/,
    );
  });

  it('includes the bad cron value in the error message', () => {
    expect(() => validateConfig({ remote: VALID_REMOTE, cron: 'bad expr' })).toThrow(/bad expr/);
  });

  it('throws when interval is less than 10', () => {
    expect(() => validateConfig({ remote: VALID_REMOTE, cron: null, interval: 9 })).toThrow(
      />= 10/,
    );
  });

  it('throws when interval is 0', () => {
    expect(() => validateConfig({ remote: VALID_REMOTE, cron: null, interval: 0 })).toThrow(
      />= 10/,
    );
  });

  it('throws when interval is a float', () => {
    expect(() => validateConfig({ remote: VALID_REMOTE, cron: null, interval: 15.5 })).toThrow(
      /positive integer/,
    );
  });
});

describe('createDefaultConfig', () => {
  it('creates a config with all correct defaults', () => {
    const config = createDefaultConfig(VALID_REMOTE);
    expect(config.remote).toBe(VALID_REMOTE);
    expect(config.branch).toBe(DEFAULT_BRANCH);
    expect(config.cron).toBe(DEFAULT_CRON);
    expect(config.interval).toBeNull();
  });

  it('accepts a custom branch', () => {
    const config = createDefaultConfig(VALID_REMOTE, 'develop');
    expect(config.branch).toBe('develop');
  });

  it('returns a config that passes validateConfig', () => {
    const config = createDefaultConfig(VALID_REMOTE);
    expect(() => validateConfig(config)).not.toThrow();
  });
});

describe('writeConfig + loadConfig', () => {
  it('round-trips a config correctly', async () => {
    const config = createDefaultConfig(VALID_REMOTE);
    await writeConfig(tempDir, config);
    const loaded = await loadConfig(tempDir);
    expect(loaded).toEqual(config);
  });

  it('writes formatted JSON to .syncthis.json', async () => {
    const config = createDefaultConfig(VALID_REMOTE);
    await writeConfig(tempDir, config);
    const raw = await readFile(join(tempDir, '.syncthis.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(config);
    expect(raw).toContain('\n');
    expect(raw).toContain('  '); // indented
  });

  it('loadConfig throws when .syncthis.json does not exist', async () => {
    await expect(loadConfig(tempDir)).rejects.toThrow('syncthis init');
  });

  it('loadConfig throws on invalid JSON', async () => {
    await fsWriteFile(join(tempDir, '.syncthis.json'), 'not-valid-json', 'utf8');
    await expect(loadConfig(tempDir)).rejects.toThrow('not valid JSON');
  });

  it('loadConfig validates the config after reading', async () => {
    await fsWriteFile(join(tempDir, '.syncthis.json'), JSON.stringify({ remote: '' }), 'utf8');
    await expect(loadConfig(tempDir)).rejects.toThrow(/"remote"/);
  });
});

describe('mergeWithFlags', () => {
  const base: SyncthisConfig = {
    remote: VALID_REMOTE,
    branch: 'main',
    cron: '*/5 * * * *',
    interval: null,
  };

  it('returns config unchanged when no flags are provided', () => {
    expect(mergeWithFlags(base, {})).toEqual(base);
  });

  it('overrides branch when branch flag is given', () => {
    const merged = mergeWithFlags(base, { branch: 'develop' });
    expect(merged.branch).toBe('develop');
    expect(merged.cron).toBe(base.cron); // unchanged
  });

  it('overrides cron and clears interval when cron flag is given', () => {
    const withInterval: SyncthisConfig = { ...base, cron: null, interval: 60 };
    const merged = mergeWithFlags(withInterval, { cron: '*/10 * * * *' });
    expect(merged.cron).toBe('*/10 * * * *');
    expect(merged.interval).toBeNull();
  });

  it('overrides interval and clears cron when interval flag is given', () => {
    const merged = mergeWithFlags(base, { interval: 120 });
    expect(merged.interval).toBe(120);
    expect(merged.cron).toBeNull();
  });

  it('does not mutate the original config object', () => {
    mergeWithFlags(base, { branch: 'other', interval: 30 });
    expect(base.branch).toBe('main');
    expect(base.cron).toBe('*/5 * * * *');
    expect(base.interval).toBeNull();
  });
});
