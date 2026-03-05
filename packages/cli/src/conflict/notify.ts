import type { Logger } from '../logger.js';

export interface ConflictNotification {
  type: 'conflict-unresolved' | 'conflict-resolved' | 'conflict-limit-reached';
  strategy: 'stop' | 'auto-both' | 'auto-newest';
  files: string[];
  dirPath: string;
  message: string;
}

export function notifyConflict(notification: ConflictNotification, logger: Logger): void {
  // v1: Nur Logging
  switch (notification.type) {
    case 'conflict-unresolved':
      logger.error(notification.message);
      break;
    case 'conflict-resolved':
      logger.info(notification.message);
      break;
    case 'conflict-limit-reached':
      logger.error(notification.message);
      break;
  }
  // TODO: Desktop-Notification-Layer hier einbinden
}
