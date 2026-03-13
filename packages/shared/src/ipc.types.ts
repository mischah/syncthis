import type { SyncthisConfig } from './config.types.js';
import type { HealthStatus, ServiceStatus } from './health.types.js';
import type { JsonOutput } from './json-output.types.js';

export interface FolderSummary {
  dirPath: string;
  name: string;
  health: HealthStatus;
  serviceStatus: ServiceStatus;
}

export interface LastCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface FolderDetail {
  dirPath: string;
  name: string;
  config: SyncthisConfig;
  health: HealthStatus;
  serviceStatus: ServiceStatus;
  lastCommit: LastCommitInfo | null;
}

export interface IpcChannels {
  // Folder management
  'folders:list': { args: undefined; result: FolderSummary[] };
  'folders:detail': { args: { dirPath: string }; result: FolderDetail };
  'folders:add': { args: never; result: never };
  'folders:remove': { args: { dirPath: string }; result: undefined };

  // Service management
  'service:start': { args: { dirPath: string }; result: JsonOutput };
  'service:stop': { args: { dirPath: string }; result: JsonOutput };
  'service:restart': { args: never; result: never };
  'service:sync-now': { args: { dirPath: string }; result: undefined };
  'service:broadcast-state': {
    args: { dirPath: string; status: 'running' | 'stopped' };
    result: undefined;
  };

  // Config
  'config:read': { args: never; result: never };
  'config:write': { args: never; result: never };

  // Health
  'health:status': { args: { dirPath: string }; result: HealthStatus };
  'health:all': { args: undefined; result: HealthStatus[] };

  // Conflict resolution
  'conflict:list-files': { args: never; result: never };
  'conflict:get-diff': { args: never; result: never };
  'conflict:resolve-file': { args: never; result: never };
  'conflict:resolve-hunk': { args: never; result: never };
  'conflict:abort': { args: never; result: never };
  'conflict:finalize': { args: never; result: never };

  // GitHub OAuth
  'github:start-auth': { args: never; result: never };
  'github:poll-auth': { args: never; result: never };
  'github:list-repos': { args: never; result: never };
  'github:status': { args: never; result: never };
  'github:disconnect': { args: never; result: never };

  // App
  'app:open-folder-picker': { args: never; result: never };
  'app:reveal-in-file-manager': { args: { dirPath: string }; result: undefined };
  'app:check-update': { args: never; result: never };
  'app:get-version': { args: undefined; result: string };
  'app:open-dashboard': { args: undefined; result: undefined };
  'app:hide-dashboard': { args: undefined; result: undefined };
  'app:quit': { args: undefined; result: undefined };
  'app:resize-popover': { args: { height: number }; result: undefined };

  // Logs
  'logs:subscribe': { args: never; result: never };
  'logs:unsubscribe': { args: never; result: never };
}

export interface IpcEvents {
  'health:changed': HealthStatus;
  'service:state-changed': { dirPath: string; status: ServiceStatus };
}
