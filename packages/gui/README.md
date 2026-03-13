# syncthis desktop app

Electron-based desktop app for [syncthis](../../README.md) — automatic Git directory synchronization. Runs as a menu bar (macOS) / system tray (Linux) app with a popover and dashboard window.

## Development

```bash
# From the repo root — install all dependencies
npm install

# Run in development mode (hot-reload)
npm run dev -w packages/gui

# Or equivalently:
npm run start -w packages/gui
```

The app starts in the system tray. On first launch with no folders registered it opens the dashboard automatically.

To add a test folder:

```bash
# Pre-initialize a folder with the CLI
syncthis init --remote https://github.com/<user>/<repo>.git
syncthis start --interval 60

# Register it with the GUI
mkdir -p ~/.syncthis
echo '["'$HOME'/syncthis-test"]' > ~/.syncthis/gui-folders.json
```

## Build

```bash
# Build for the current platform (macOS → DMG, Linux → AppImage + deb)
npm run make -w packages/gui

# Build outputs in packages/gui/out/make/
```

Cross-compilation is not supported — macOS builds require macOS, Linux builds require Linux. CI handles both platforms.

## macOS Gatekeeper (unsigned builds)

The distributed binary is not code-signed in v1. To open it for the first time:

1. Right-click the app → **Open**
2. Click **Open** in the dialog

## Troubleshooting

**Stale tray icons after stopping dev:** Stale Electron processes are killed automatically on the next `npm run dev` / `npm run start` via a `predev`/`prestart` hook.

**Vite cache issues (stale UI, broken HMR):** Clear the Vite cache and restart:

```bash
rm -rf packages/gui/node_modules/.vite
npm run dev -w packages/gui
```

## Notes

- The app bundles the `syncthis` CLI to `~/.syncthis/bin/syncthis` on first launch.
- No dock icon is shown when the dashboard is closed; it reappears while the dashboard is open.
- Closing the dashboard hides it (services keep running). Use **Cmd+Q** to quit.
