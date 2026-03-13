# Future Ideas

These features are intentionally out of scope for now but may be explored later:

- **GUI** — A desktop app (`packages/gui`) that wraps the CLI as a subprocess (Electron / Tauri / web-based).
- **File watcher** — Trigger a sync immediately on file changes via `fs.watch`, instead of waiting for the next scheduled cycle.
- **Log rotation** — Automatically rotate or clean up log files by size or age.
- **Conflict cleanup** — A `syncthis cleanup` command to remove `.conflict-*` files from the directory (conflict copies are intentionally committed and synced to all devices so you can review them anywhere).
- **Conflict history** — Persistent log of which conflicts occurred, when, and how they were resolved, stored in `.syncthis/conflict-log.json`.
- **Dry-run mode** — `syncthis start --dry-run` to preview what would happen without making any changes.
- **Custom commit messages** — A template system for auto-commit message formatting.
- **Config migration** — Automatically update `.syncthis.json` on schema changes.
- **Standalone distribution** — Ship without requiring Node.js:
  - *Stage 1:* Homebrew formula with Node as a dependency (`brew install syncthis`).
  - *Stage 2:* Self-contained binaries via `bun build --compile` or Node SEA, built by GitHub Actions for macOS (arm64 + x64), Linux (x64), and Windows (x64).
- **Windows service support** — Service mode currently supports macOS (launchd) and Linux (systemd). Windows support could be added via Windows Service Manager or [NSSM](https://nssm.cc).
- **Service updates** — When syncthis is updated, existing service definitions may still point to the old binary path. A `syncthis update` command or automatic detection in `syncthis status` could handle this.
- **Automated releases** — Conventional Commits + `commit-and-tag-version` (or `release-it`) for SemVer tagging, auto-generated `CHANGELOG.md`, and a GitHub Actions workflow that publishes to npm on tag push.
