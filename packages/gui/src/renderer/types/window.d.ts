import type { IpcChannels, IpcEvents } from '@syncthis/shared';

declare global {
  interface Window {
    syncthis: {
      invoke: <K extends keyof IpcChannels>(
        channel: K,
        args: IpcChannels[K]['args'],
      ) => Promise<IpcChannels[K]['result']>;
      on: <K extends keyof IpcEvents>(
        event: K,
        callback: (data: IpcEvents[K]) => void,
      ) => () => void;
    };
  }
}
