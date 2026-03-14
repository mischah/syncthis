import type { IpcChannels, IpcEvents } from '@syncthis/shared';
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('syncthis', {
  invoke: <K extends keyof IpcChannels>(
    channel: K,
    args: IpcChannels[K]['args'],
  ): Promise<IpcChannels[K]['result']> => ipcRenderer.invoke(channel, args),

  on: <K extends keyof IpcEvents>(
    event: K,
    callback: (data: IpcEvents[K]) => void,
  ): (() => void) => {
    const handler = (_: unknown, data: IpcEvents[K]) => callback(data);
    ipcRenderer.on(event, handler);
    return () => {
      ipcRenderer.removeListener(event, handler);
    };
  },
});
