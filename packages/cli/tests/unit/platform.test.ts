import { isAbsolute } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/daemon/launchd.js', () => ({
  LaunchdPlatform: vi.fn(),
}));

vi.mock('../../src/daemon/systemd.js', () => ({
  SystemdPlatform: vi.fn(),
}));

import { LaunchdPlatform } from '../../src/daemon/launchd.js';
import { getNodeBinary, getPlatform, getSyncthisBinary } from '../../src/daemon/platform.js';
import { SystemdPlatform } from '../../src/daemon/systemd.js';

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.clearAllMocks();
});

describe('getPlatform', () => {
  it('returns a LaunchdPlatform instance on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    getPlatform();
    expect(LaunchdPlatform).toHaveBeenCalledOnce();
  });

  it('returns a SystemdPlatform instance on linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    getPlatform();
    expect(SystemdPlatform).toHaveBeenCalledOnce();
  });

  it('throws an error on an unsupported platform', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    expect(() => getPlatform()).toThrow(
      "Daemon mode is not supported on win32. Use 'syncthis start' instead.",
    );
  });
});

describe('getSyncthisBinary', () => {
  it('returns an absolute path', () => {
    const binary = getSyncthisBinary();
    expect(isAbsolute(binary)).toBe(true);
  });
});

describe('getNodeBinary', () => {
  it('returns an absolute path matching process.execPath', () => {
    const nodeBin = getNodeBinary();
    expect(nodeBin).toBe(process.execPath);
    expect(isAbsolute(nodeBin)).toBe(true);
  });
});
