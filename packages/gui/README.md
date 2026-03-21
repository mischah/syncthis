[![codecov](https://codecov.io/gh/mischah/syncthis/branch/main/graph/badge.svg?flag=gui)](https://codecov.io/gh/mischah/syncthis)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/mischah)

# syncthis desktop

syncthis desktop — a tray app for automatic folder sync via Git. Runs as a menu bar (macOS) / system tray (Linux) app with a popover and dashboard window.

See [syncthis](../../README.md) for the full project overview.

## Prerequisites

- Node.js ≥ 20
- npm

## Development

```bash
# Install dependencies (from repo root)
npm install

# Run in development mode
npm run dev:gui

# Or from the package directly
npm run start -w packages/gui
```

The app starts in the system tray. On first launch with no folders registered it opens the dashboard automatically.

## Building

```bash
# Build for current platform
npm run make:gui

# Output in packages/gui/out/make/
```

Cross-compilation is not supported — macOS builds require macOS, Linux builds require Linux.

## Icon Generation

```bash
npm run generate:icons -w packages/gui
npm run generate:app-icon -w packages/gui
```

## Notes

- The app bundles the `syncthis` CLI to `~/.syncthis/bin/syncthis` on first launch.
- No dock icon is shown when the dashboard is closed; it reappears while the dashboard is open.
- Closing the dashboard hides it (services keep running). Use the tray context menu → **Quit** to exit.

## Troubleshooting

**Stale tray icons after stopping dev:** Stale Electron processes are killed automatically on the next `npm run dev:gui` via a `predev`/`prestart` hook.

**Vite cache issues (stale UI, broken HMR):** Clear the Vite cache and restart:

```bash
rm -rf packages/gui/node_modules/.vite
npm run dev:gui
```

## Support

If you find syncthis useful, consider supporting its development:

- [GitHub Sponsors](https://github.com/sponsors/mischah)
- [PayPal](https://paypal.me/dazzlingtone)
