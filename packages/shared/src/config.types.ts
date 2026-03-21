export type ConflictStrategy = 'stop' | 'auto-both' | 'auto-newest' | 'ask';

export interface SyncthisConfig {
  remote: string;
  branch: string;
  cron: string | null;
  interval: number | null;
  daemonLabel?: string | null;
  autostart?: boolean;
  onConflict: ConflictStrategy;
  notify?: boolean;
}

export interface CliFlags {
  branch?: string;
  cron?: string;
  interval?: number;
  onConflict?: ConflictStrategy;
  notify?: boolean;
}
