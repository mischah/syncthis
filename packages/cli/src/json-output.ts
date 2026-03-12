export interface JsonSuccess<T = unknown> {
  ok: true;
  command: string;
  data: T;
}

export interface JsonError {
  ok: false;
  command: string;
  error: { message: string; code?: string };
}

export type JsonOutput<T = unknown> = JsonSuccess<T> | JsonError;

export function printJson<T>(command: string, data: T): void {
  const output: JsonSuccess<T> = { ok: true, command, data };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export function printJsonError(command: string, message: string, code?: string): never {
  const output: JsonError = {
    ok: false,
    command,
    error: { message, ...(code !== undefined && { code }) },
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exit(1);
}

// Per-command data shapes

export interface InitData {
  dirPath: string;
  remote: string;
  branch: string;
  cloned: boolean;
}

export interface DaemonStartData {
  dirPath: string;
  started: boolean;
  pid?: number;
  warning?: string;
  alreadyRunning?: boolean;
}

export interface DaemonStopData {
  dirPath: string;
  stopped: boolean;
  pid?: number;
  alreadyStopped?: boolean;
  foregroundStopped?: boolean;
}

export interface DaemonUninstallData {
  dirPath: string;
  uninstalled: boolean;
  notInstalled?: boolean;
}

export interface BatchData {
  results: Array<{
    label: string;
    dirPath: string;
    outcome: 'ok' | 'skipped' | 'failed';
    message: string;
  }>;
}

export interface StatusData {
  dirPath: string;
  initialized: boolean;
  config: {
    remote: string;
    branch: string;
    schedule: string;
    onConflict: string;
    logPath: string;
  } | null;
  syncProcess: {
    running: boolean;
    pid?: number;
    schedule?: string;
  };
  git: {
    branch: string;
    remote?: string;
    uncommittedChanges: number;
    rebaseInProgress: boolean;
    lastCommit: { date: string; message: string } | null;
  } | null;
  service: {
    state: 'running' | 'stopped' | 'not-installed';
    pid?: number;
    label?: string;
    autostart?: boolean;
  } | null;
}
