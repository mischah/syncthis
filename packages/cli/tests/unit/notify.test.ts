import { describe, expect, it, vi } from 'vitest';
import { type ConflictNotification, notifyConflict } from '../../src/conflict/notify.js';
import type { Logger } from '../../src/logger.js';

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const BASE: ConflictNotification = {
  strategy: 'stop',
  files: ['notes/daily.md', 'notes/todo.md'],
  dirPath: '/home/user/vault',
  message: 'Test message',
};

describe('notifyConflict', () => {
  it('conflict-unresolved → calls logger.error with the message', () => {
    const logger = makeLogger();
    const notification: ConflictNotification = { ...BASE, type: 'conflict-unresolved' };
    notifyConflict(notification, logger);
    expect(logger.error).toHaveBeenCalledWith(notification.message);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('conflict-resolved → calls logger.info with the message', () => {
    const logger = makeLogger();
    const notification: ConflictNotification = {
      ...BASE,
      type: 'conflict-resolved',
      strategy: 'auto-both',
    };
    notifyConflict(notification, logger);
    expect(logger.info).toHaveBeenCalledWith(notification.message);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('conflict-limit-reached → calls logger.error with the message', () => {
    const logger = makeLogger();
    const notification: ConflictNotification = {
      ...BASE,
      type: 'conflict-limit-reached',
      strategy: 'auto-newest',
    };
    notifyConflict(notification, logger);
    expect(logger.error).toHaveBeenCalledWith(notification.message);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('notification contains the passed file list', () => {
    const logger = makeLogger();
    const files = ['a.md', 'b.md', 'c.md'];
    const notification: ConflictNotification = {
      ...BASE,
      type: 'conflict-resolved',
      strategy: 'auto-both',
      files,
    };
    notifyConflict(notification, logger);
    expect(notification.files).toEqual(files);
  });
});
