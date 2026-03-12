import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.hoisted(() => vi.fn());
vi.mock('../../src/config.js', () => ({
  loadConfig: mockLoadConfig,
}));

const mockDetermineHealth = vi.hoisted(() => vi.fn());
vi.mock('../../src/health-check.js', () => ({
  determineHealth: mockDetermineHealth,
}));

const mockGetPlatform = vi.hoisted(() => vi.fn());
vi.mock('../../src/daemon/platform.js', () => ({
  getPlatform: mockGetPlatform,
}));

const mockPrintJson = vi.hoisted(() => vi.fn());
const mockPrintJsonError = vi.hoisted(() => vi.fn());
vi.mock('../../src/json-output.js', () => ({
  printJson: mockPrintJson,
  printJsonError: mockPrintJsonError,
}));

import { handleHealth } from '../../src/commands/health.js';

const healthyResult = {
  status: 'healthy' as const,
  reasons: [],
  processRunning: true,
  uptime: 3600,
  data: {
    startedAt: '2026-01-01T00:00:00.000Z',
    lastSyncAt: new Date(Date.now() - 60_000).toISOString(),
    lastSyncResult: 'synced' as const,
    consecutiveFailures: 0,
    lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
    cycleCount: 12,
  },
};

const degradedResult = {
  status: 'degraded' as const,
  reasons: ['Sync overdue by 5 minutes', '3 consecutive failures'],
  processRunning: true,
  uptime: 7200,
  data: {
    startedAt: '2026-01-01T00:00:00.000Z',
    lastSyncAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    lastSyncResult: 'network-error' as const,
    consecutiveFailures: 3,
    lastSuccessAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    cycleCount: 8,
  },
};

describe('handleHealth', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockLoadConfig.mockRejectedValue(new Error('no config'));
  });

  describe('single directory', () => {
    it('prints healthy status', async () => {
      mockDetermineHealth.mockResolvedValue(healthyResult);
      await handleHealth({ path: '/some/dir' });
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toMatch(/Health: healthy/);
      expect(output).toMatch(/Last sync:/);
      expect(output).toMatch(/Sync cycles:\s+12/);
    });

    it('prints degraded status with reasons', async () => {
      mockDetermineHealth.mockResolvedValue(degradedResult);
      await handleHealth({ path: '/some/dir' });
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toMatch(/Health: degraded/);
      expect(output).toMatch(/Sync overdue by 5 minutes/);
      expect(output).toMatch(/3 consecutive failures/);
    });

    it('outputs JSON when --json flag is set', async () => {
      mockDetermineHealth.mockResolvedValue(healthyResult);
      await handleHealth({ path: '/some/dir', json: true });
      expect(mockPrintJson).toHaveBeenCalledWith(
        'health',
        expect.objectContaining({
          dirPath: '/some/dir',
          status: 'healthy',
          processRunning: true,
          cycleCount: 12,
        }),
      );
    });

    it('includes reasons in JSON output', async () => {
      mockDetermineHealth.mockResolvedValue(degradedResult);
      await handleHealth({ path: '/some/dir', json: true });
      expect(mockPrintJson).toHaveBeenCalledWith(
        'health',
        expect.objectContaining({
          status: 'degraded',
          reasons: ['Sync overdue by 5 minutes', '3 consecutive failures'],
        }),
      );
    });
  });

  describe('--all mode', () => {
    it('prints message when no services registered', async () => {
      mockGetPlatform.mockReturnValue({ listAll: vi.fn().mockResolvedValue([]) });
      await handleHealth({ path: '/some/dir', all: true });
      expect(logSpy).toHaveBeenCalledWith('No syncthis services registered.');
    });

    it('outputs JSON with services array when no services', async () => {
      mockGetPlatform.mockReturnValue({ listAll: vi.fn().mockResolvedValue([]) });
      await handleHealth({ path: '/some/dir', all: true, json: true });
      expect(mockPrintJson).toHaveBeenCalledWith('health', { services: [] });
    });

    it('checks health for each registered service', async () => {
      const daemons = [
        { label: 'com.syncthis.vault', dirPath: '/vault', state: 'running' },
        { label: 'com.syncthis.notes', dirPath: '/notes', state: 'stopped' },
      ];
      mockGetPlatform.mockReturnValue({ listAll: vi.fn().mockResolvedValue(daemons) });
      mockDetermineHealth.mockResolvedValue(healthyResult);

      await handleHealth({ path: '/some/dir', all: true });
      expect(mockDetermineHealth).toHaveBeenCalledTimes(2);
    });

    it('outputs JSON with all services health', async () => {
      const daemons = [{ label: 'com.syncthis.vault', dirPath: '/vault', state: 'running' }];
      mockGetPlatform.mockReturnValue({ listAll: vi.fn().mockResolvedValue(daemons) });
      mockDetermineHealth.mockResolvedValue(healthyResult);

      await handleHealth({ path: '/some/dir', all: true, json: true });
      expect(mockPrintJson).toHaveBeenCalledWith('health', {
        services: [expect.objectContaining({ dirPath: '/vault', status: 'healthy' })],
      });
    });
  });
});
