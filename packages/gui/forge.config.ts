import { readFileSync } from 'node:fs';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '**/dugite/git/**' },
    name: 'syncthis',
    executableName: 'syncthis',
    appBundleId: 'com.syncthis.desktop',
    appCategoryType: 'public.app-category.productivity',
    icon: './resources/icon',
    extraResource: ['resources/tray', '../cli/dist'],
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({ name: `syncthis-${version}-mac` }, ['darwin']),
    new MakerDeb({ options: { bin: 'syncthis' } }, ['linux']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'dashboard',
          config: 'vite.renderer.config.ts',
        },
        {
          name: 'popover',
          config: 'vite.popover.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
