import type { SyncthisConfig } from './config.types.js';
import type { HealthStatus, ServiceStatus } from './health.types.js';
import type { JsonOutput } from './json-output.types.js';

export interface AppSettings {
  launchOnLogin: boolean;
  defaults: {
    interval: number; // in seconds
    onConflict: 'auto-both' | 'auto-newest' | 'ask';
  };
  github: {
    token?: string;
    username?: string;
  };
  dismissedUpdateVersion?: string;
}

export type LogEntryType =
  | 'synced'
  | 'synced-no-changes'
  | 'pulled'
  | 'push-failed'
  | 'conflict'
  | 'started'
  | 'error'
  | 'other';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  type: LogEntryType;
}

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
  'folders:add': {
    args: {
      mode: 'clone' | 'existing';
      repoUrl: string;
      dirPath: string;
      interval: number;
      onConflict: 'auto-both' | 'auto-newest' | 'ask';
      useOAuth: boolean;
    };
    result: {
      dirPath: string;
      name: string;
      remote: string;
      interval: number;
      serviceStarted: boolean;
    };
  };
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
  'config:read': { args: { dirPath: string }; result: SyncthisConfig };
  'config:write': { args: { dirPath: string; config: SyncthisConfig }; result: undefined };

  // Gitignore
  'gitignore:read': { args: { dirPath: string }; result: string };
  'gitignore:write': { args: { dirPath: string; content: string }; result: undefined };

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
  'github:start-auth': {
    args: undefined;
    result: {
      verificationUri: string;
      userCode: string;
      deviceCode: string;
      interval: number;
      expiresIn: number;
    };
  };
  'github:poll-auth': {
    args: { deviceCode: string; interval: number };
    result:
      | { status: 'pending'; newInterval?: number }
      | { status: 'complete'; token: string; username: string }
      | { status: 'error'; message: string };
  };
  'github:list-repos': {
    args: undefined;
    result: Array<{
      name: string;
      fullName: string;
      private: boolean;
      pushedAt: string;
      cloneUrl: string;
    }>;
  };
  'github:create-repo': {
    args: { name: string };
    result: {
      name: string;
      fullName: string;
      private: boolean;
      pushedAt: string;
      cloneUrl: string;
    };
  };
  'github:status': { args: undefined; result: { connected: boolean; username?: string } };
  'github:disconnect': { args: undefined; result: undefined };
  'github:open-auth-page': { args: { url: string }; result: undefined };

  // Credentials
  'credentials:setup': { args: { dirPath: string }; result: undefined };

  // Git
  'git:validate-remote': { args: { url: string }; result: { valid: boolean; message?: string } };

  // App
  'app:open-folder-picker': { args: undefined; result: string | null };
  'app:reveal-in-file-manager': { args: { dirPath: string }; result: undefined };
  'app:check-update': { args: never; result: never };
  'app:get-version': { args: undefined; result: string };
  'app:open-dashboard': { args: { view?: string } | undefined; result: undefined };
  'app:hide-dashboard': { args: undefined; result: undefined };
  'app:quit': { args: undefined; result: undefined };
  'app:resize-popover': { args: { height: number }; result: undefined };
  'app:settings-read': { args: undefined; result: AppSettings };
  'app:settings-write': { args: AppSettings; result: undefined };

  // Logs
  'logs:recent': { args: { dirPath: string; maxLines?: number }; result: LogEntry[] };
  'logs:subscribe': { args: { dirPath: string }; result: undefined };
  'logs:unsubscribe': { args: { dirPath: string }; result: undefined };
}

export interface IpcEvents {
  'health:changed': HealthStatus;
  'service:state-changed': { dirPath: string; status: ServiceStatus };
  'logs:line': { dirPath: string; entry: LogEntry };
  'app:navigate': { view: string };
}
