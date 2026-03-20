import type { SyncthisConfig } from './config.types.js';
import type { HealthStatus, ServiceStatus } from './health.types.js';
import type { JsonOutput } from './json-output.types.js';

export interface ConflictFile {
  filePath: string;
  status: 'pending' | 'resolved';
}

export interface DiffChange {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

export interface DiffLine {
  type: 'context' | 'local' | 'remote';
  text: string;
}

export interface DiffHunk {
  index: number;
  startLine: number;
  localLines: string[];
  remoteLines: string[];
  changes: DiffChange[];
  lines: DiffLine[];
}

export interface ImageData {
  mimeType: string;
  localDataUrl: string;
  remoteDataUrl: string;
  localSize: number;
  remoteSize: number;
}

export interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
  sourceLines: string[];
  isBinary?: boolean;
  imageData?: ImageData;
}

export interface UpdateInfo {
  version: string;
  releaseUrl: string;
  publishedAt: string;
}

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
  lingerWarningDismissed?: boolean;
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
  conflictDetected: boolean;
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
  'conflict:check': { args: { dirPath: string }; result: boolean };
  'conflict:list-files': { args: { dirPath: string }; result: ConflictFile[] };
  'conflict:get-diff': { args: { dirPath: string; filePath: string }; result: FileDiff };
  'conflict:resolve-file': {
    args: { dirPath: string; filePath: string; choice: 'local' | 'remote' | 'both' };
    result: undefined;
  };
  'conflict:resolve-hunks': {
    args: { dirPath: string; filePath: string; decisions: Array<'local' | 'remote'> };
    result: undefined;
  };
  'conflict:abort': { args: { dirPath: string }; result: undefined };
  'conflict:finalize': { args: { dirPath: string }; result: undefined };

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
  'app:check-update': { args: undefined; result: UpdateInfo | null };
  'app:dismiss-update': { args: { version: string }; result: undefined };
  'app:open-release-page': { args: { url: string }; result: undefined };
  'app:get-version': { args: undefined; result: string };
  'app:open-dashboard': {
    args: { view?: string; activeFolderPath?: string } | undefined;
    result: undefined;
  };
  'app:hide-dashboard': { args: undefined; result: undefined };
  'app:quit': { args: undefined; result: undefined };
  'app:resize-popover': { args: { height: number }; result: undefined };
  'app:settings-read': { args: undefined; result: AppSettings };
  'app:settings-write': { args: AppSettings; result: undefined };
  'app:linger-status': { args: undefined; result: { show: boolean } };
  'app:dismiss-linger': { args: undefined; result: undefined };

  // Logs
  'logs:recent': { args: { dirPath: string; maxLines?: number }; result: LogEntry[] };
  'logs:subscribe': { args: { dirPath: string }; result: undefined };
  'logs:unsubscribe': { args: { dirPath: string }; result: undefined };
}

export interface IpcEvents {
  'health:changed': HealthStatus;
  'service:state-changed': { dirPath: string; status: ServiceStatus };
  'logs:line': { dirPath: string; entry: LogEntry };
  'app:navigate': { view: string; activeFolderPath?: string };
  'conflict:detected': { dirPath: string };
  'update:available': UpdateInfo;
}
