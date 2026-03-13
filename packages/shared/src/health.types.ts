export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthStatus {
  dirPath: string;
  level: HealthLevel;
  lastSync: string | null;
  uptime: number | null;
  consecutiveFailures: number;
  syncCycles: number;
  serviceRunning: boolean;
}

export type ServiceStatus = 'running' | 'stopped' | 'not-installed';
