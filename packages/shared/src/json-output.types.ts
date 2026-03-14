export type JsonOutput<T = unknown> =
  | { ok: true; command: string; data: T }
  | { ok: false; command: string; error: { message: string; code?: string } };
