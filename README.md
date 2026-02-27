[![npm version](https://img.shields.io/npm/v/syncthis.svg)](https://www.npmjs.com/package/syncthis)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/mischah/syncthis/actions/workflows/ci.yml/badge.svg)](https://github.com/mischah/syncthis/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/mischah/syncthis/branch/main/graph/badge.svg)](https://codecov.io/gh/mischah/syncthis)

# syncthis

> Automatic directory synchronization via Git.

Commits, pulls, and pushes your changes on a configurable schedule — no manual `git` commands needed. Runs as a background service managed by your OS.

**Primary use case:** Keep your [Obsidian](https://obsidian.md) vault in sync across multiple devices.

---

## Table of Contents

- [Quick Start for Obsidian Users](#quick-start-for-obsidian-users)
- [Installation](#installation)
- [Commands](#commands)
  - [syncthis init](#syncthis-init)
  - [syncthis daemon](#syncthis-daemon)
  - [syncthis status](#syncthis-status)
  - [syncthis start (foreground)](#syncthis-start-foreground)
- [How It Works](#how-it-works)
- [Configuration](#configuration)
- [Logging](#logging)
- [Development](#development)
- [Future Ideas](#future-ideas)
- [License](#license)

---

## Quick Start for Obsidian Users

> Not a developer? This section is for you. If you're comfortable with the terminal, skip to [Installation](#installation).

**What syncthis does:** It runs in the background and automatically commits and syncs your Obsidian vault to a private Git repository (e.g. on GitHub). This keeps your notes in sync across all your devices — without any manual steps.

**Prerequisites:**

1. **Git** installed — check with `git --version` in your terminal. If missing, [download it here](https://git-scm.com/downloads).
2. **Node.js 20+** installed — check with `node --version`. If missing, [download it here](https://nodejs.org).
3. A **private GitHub repository** created for your vault (e.g. `github.com/yourname/my-vault`).
4. **SSH access to GitHub** configured — follow [GitHub's SSH guide](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) if you haven't done this yet.

**Setup (one-time, takes ~2 minutes):**

```bash
# 1. Install syncthis
npm install -g syncthis

# 2. Go to your vault folder
cd /path/to/your/obsidian-vault

# 3. Initialize — links your vault to your GitHub repo
syncthis init --remote git@github.com:yourname/my-vault.git

# 4. Start syncing in the background (every 5 minutes by default)
syncthis daemon start
```

That's it. You can close the terminal — syncthis runs as a background service managed by your OS. On your other devices, repeat steps 2–4 using `--clone` instead of `--remote`:

```bash
# On your second device: clone and start syncing
syncthis init --clone git@github.com:yourname/my-vault.git --path /path/to/vault
syncthis daemon start
```

**Check the status anytime:**

```bash
syncthis daemon status
```

**Stop syncing:**

```bash
syncthis daemon stop
```

---

## Installation

```bash
npm install -g syncthis
```

Or run without installing:

```bash
npx syncthis init --remote git@github.com:yourname/vault.git
```

**Requirements:** Node.js ≥ 20.0.0, Git installed and accessible in `PATH`.

**Supported platforms:** macOS (launchd), Linux (systemd).

---

## Commands

### `syncthis init`

Initializes a directory for syncing. Two modes:

**Mode A — Initialize an existing directory:**

```bash
syncthis init --remote git@github.com:user/vault.git
syncthis init --remote git@github.com:user/vault.git --path /home/user/my-vault
```

- Runs `git init` if the directory is not already a Git repo.
- Adds the remote as `origin`.
- Creates `.syncthis.json` with default configuration.
- Creates a `.gitignore` with Obsidian-specific defaults (only if none exists).
- Makes an initial commit if there are untracked files.

**Mode B — Clone a remote repository:**

```bash
syncthis init --clone git@github.com:user/vault.git
syncthis init --clone git@github.com:user/vault.git --path ./my-vault
```

- Clones the repository into the target directory.
- Creates `.syncthis.json`.

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--remote` | string | Remote URL (Mode A) |
| `--clone` | string | Repository URL to clone (Mode B) |
| `--path` | string | Target directory. Default: current directory |
| `--branch` | string | Branch name. Default: `main` |

`--remote` and `--clone` are mutually exclusive.

---

### `syncthis daemon`

Manages the background sync service. This is the recommended way to run syncthis — the OS handles starting, stopping, and restarting the process for you.

#### `syncthis daemon start`

Installs (if needed) and starts the background sync service.

```bash
syncthis daemon start
syncthis daemon start --path ~/vault
syncthis daemon start --label my-vault
syncthis daemon start --enable-autostart
```

- Creates an OS service (launchd on macOS, systemd on Linux).
- Starts syncing immediately in the background.
- If a service already exists and is running: does nothing (idempotent).
- The service auto-restarts if it crashes unexpectedly.

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--path` | string | Directory to sync. Default: current directory |
| `--label` | string | Custom service name. Default: derived from directory path |
| `--enable-autostart` | boolean | Start automatically on login. Default: `false` |
| `--cron` | string | Cron expression. Persisted in the service definition. |
| `--interval` | number | Interval in seconds. Persisted in the service definition. |
| `--log-level` | string | `debug`, `info`, `warn`, `error`. Default: `info` |

#### `syncthis daemon stop`

Stops the background sync service. The service stays installed and can be restarted with `daemon start`.

```bash
syncthis daemon stop
syncthis daemon stop --path ~/vault
```

#### `syncthis daemon status`

Shows the status of all registered daemons, or a specific one.

```bash
# All daemons
syncthis daemon status

# Specific daemon
syncthis daemon status --path ~/vault
```

**Example output (all daemons):**

```
syncthis daemons:

  ● vault-notes     running   /home/user/vault-notes     autostart: off
  ○ work-notes      stopped   /home/user/work/notes      autostart: on
```

#### `syncthis daemon uninstall`

Stops and completely removes the service from the OS.

```bash
syncthis daemon uninstall
syncthis daemon uninstall --path ~/vault
```

Your files, `.syncthis.json`, and logs are not deleted — only the OS service registration is removed.

#### `syncthis daemon logs`

Shows the daemon's log output.

```bash
syncthis daemon logs                    # Last 50 lines
syncthis daemon logs --follow           # Live output (Ctrl+C to stop)
syncthis daemon logs --lines 100        # Last 100 lines
```

---

### `syncthis status`

Shows the current sync status of a directory (independent of daemon mode).

```bash
syncthis status
syncthis status --path /home/user/my-vault
```

**Output includes:**

- Whether `.syncthis.json` exists and is valid.
- Whether a sync process is currently running (with PID).
- Git info: branch, remote URL, number of uncommitted changes, last commit.

Works even without `.syncthis.json` (shows "Not initialized").

---

### `syncthis start` (foreground)

Runs the sync loop in the foreground, attached to the terminal. The process stops when the terminal is closed.

```bash
syncthis start
syncthis start --path /home/user/my-vault
syncthis start --cron "*/5 * * * *"
syncthis start --interval 300
```

> **For most users, [`syncthis daemon start`](#syncthis-daemon-start) is the better choice** — it runs in the background and survives terminal close. Use `syncthis start` when you want to see live output for debugging, or in environments without a service layer (e.g. Docker containers).

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--path` | string | Directory to sync. Default: current directory |
| `--cron` | string | Cron expression. Overrides config. |
| `--interval` | number | Interval in seconds. Overrides config. |
| `--log-level` | string | `debug`, `info`, `warn`, `error`. Default: `info` |

`--cron` and `--interval` are mutually exclusive. CLI flags take priority over `.syncthis.json`.

---

## How It Works

### Sync cycle

Every sync cycle follows these steps:

```
Scheduled trigger (cron or interval)
          │
          ▼
  ┌───────────────────┐   No local      ┌─────────────────────────────────────┐
  │  git status       │── changes ─────►│  git pull --rebase                  │
  └────────┬──────────┘                 └──┬──────────────────────────────────┘
           │ Changes detected              │ OK                  │ Conflict/Error
           ▼                              ▼                      ▼
  ┌───────────────────┐            HEAD changed?          ❌ Sync paused /
  │  git add -A       │             │         │            ⚠️  retry next cycle
  └────────┬──────────┘            Yes        No
           │                        │         │
           ▼                        ▼         ▼
  ┌──────────────────────────┐  ✅ Pulled  ✅ No-op
  │  git commit -m "sync:…"  │  remote
  └────────┬─────────────────┘  changes
           │
           ▼
  ┌───────────────────────┐
  │  git pull --rebase    │──── Conflict / Error ────────► ❌ / ⚠️  (see above)
  └────────┬──────────────┘
           │ OK
           ▼
  ┌───────────────────┐
  │  git push         │──── Network error ───────────────► ⚠️  Log warning,
  └────────┬──────────┘                                        retry next cycle
           │ OK
           ▼
        ✅ Done
```

**Conflict handling:** syncthis never resolves conflicts automatically. If a rebase conflict occurs, the sync loop stops and exits with code 1. Resolve the conflict manually (`git rebase --continue`), then restart with `syncthis daemon start` or `syncthis start`.

**Offline support:** If the network is unavailable, the local commit succeeds. The pull and push failures are logged as warnings, and the loop continues. Everything syncs on the next successful cycle.

**Single instance:** A `.syncthis.lock` file prevents multiple instances from running against the same directory. Stale locks (left by a crash) are detected automatically by checking the recorded PID.

### Daemon lifecycle

When using `syncthis daemon start`, the OS manages the sync process:

- **macOS:** Registered as a launchd LaunchAgent (`~/Library/LaunchAgents/`). The service runs `syncthis start` internally as a foreground process — launchd handles daemonization.
- **Linux:** Registered as a systemd user unit (`~/.config/systemd/user/`). Uses `systemctl --user` for management.

The OS auto-restarts the service on unexpected exits (crash, rebase conflict after manual resolution). Graceful stops via `syncthis daemon stop` or `SIGTERM` are not restarted.

> **Linux note:** For the daemon to keep running after logout, user lingering must be enabled: `loginctl enable-linger $USER` (may require sudo). syncthis warns you if this isn't configured.

---

## Configuration

`syncthis init` creates a `.syncthis.json` in the synced directory:

```json
{
  "remote": "git@github.com:user/vault.git",
  "branch": "main",
  "cron": "*/5 * * * *",
  "interval": null
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `remote` | string | Yes | — | Remote repository URL |
| `branch` | string | No | `"main"` | Branch to sync |
| `cron` | string \| null | No | `"*/5 * * * *"` | Cron expression |
| `interval` | number \| null | No | `null` | Interval in seconds (≥ 10) |

Exactly one of `cron` or `interval` must be set. CLI flags always override the config file.

**Common cron expressions:**

| Expression | Meaning |
|------------|---------|
| `*/5 * * * *` | Every 5 minutes (default) |
| `*/1 * * * *` | Every minute |
| `0 * * * *` | Every hour |

Or use `--interval` for a simple seconds-based schedule:

```bash
syncthis start --interval 60   # every 60 seconds
```

---

## Logging

Logs are written to both **stdout** and **`.syncthis/logs/syncthis.log`** in the synced directory.

**Format:**
```
[2025-02-20T14:30:00.000Z] [INFO]  Sync started. Schedule: */5 * * * *. Watching: /home/user/vault
[2025-02-20T14:35:00.000Z] [INFO]  Sync cycle: 3 files changed, committed, pushed.
[2025-02-20T14:40:00.000Z] [WARN]  Push failed: Network unreachable. Will retry next cycle.
[2025-02-20T14:45:00.000Z] [ERROR] Rebase conflict detected. Sync paused. Resolve conflicts manually.
```

Control log verbosity with `--log-level`:

```bash
syncthis start --log-level debug   # verbose output
syncthis start --log-level warn    # warnings and errors only
```

**Daemon mode logging:** In addition to the app log file, stdout/stderr are captured by the OS service layer. On macOS, these are stored in `.syncthis/logs/launchd-stdout.log` and `.syncthis/logs/launchd-stderr.log`. On Linux, they go to the systemd journal and can be viewed with `journalctl --user -u syncthis-<label>`. Use `syncthis daemon logs` as a shortcut.

---

## Development

### Setup

```bash
git clone git@github.com:mischah/syncthis.git
cd syncthis
npm install
```

### Useful Scripts

| Command | Description |
|---------|-------------|
| `npm run dev -w packages/cli -- -- --help` | Run CLI in dev mode |
| `npm test` | Run all tests |
| `npm run build` | Build `dist/cli.js` |
| `npm run lint` | Lint and check formatting |
| `npm run lint:fix` | Auto-fix lint and formatting issues |
| `npm run typecheck -w packages/cli` | Type-check without building |

### Project Structure

```
syncthis/
├── packages/
│   └── cli/
│       ├── src/
│       │   ├── cli.ts           # Entry point, command routing
│       │   ├── commands/
│       │   │   ├── init.ts
│       │   │   ├── start.ts
│       │   │   ├── status.ts
│       │   │   └── daemon.ts    # Daemon subcommand handler
│       │   ├── daemon/
│       │   │   ├── platform.ts  # DaemonPlatform interface + factory
│       │   │   ├── launchd.ts   # macOS launchd implementation
│       │   │   ├── systemd.ts   # Linux systemd implementation
│       │   │   ├── service-name.ts  # Service naming + slugify
│       │   │   └── templates.ts # Plist / unit file generation
│       │   ├── config.ts        # Config loading & validation
│       │   ├── sync.ts          # Git sync cycle
│       │   ├── scheduler.ts     # Cron / interval scheduler
│       │   ├── lock.ts          # Process lock management
│       │   └── logger.ts        # stdout + file logging
│       └── tests/
│           ├── unit/
│           └── integration/
├── biome.json                   # Linting & formatting
└── tsconfig.base.json
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js ≥ 20 |
| Language | TypeScript 5 (ESM) |
| CLI framework | [meow](https://github.com/sindresorhus/meow) |
| Git operations | [simple-git](https://github.com/steveukx/git-js) |
| Scheduler | [croner](https://github.com/Hexagon/croner) |
| Bundler | [tsdown](https://github.com/sxzz/tsdown) |
| Tests | [Vitest](https://vitest.dev) + [execa](https://github.com/sindresorhus/execa) |
| Linting | [Biome](https://biomejs.dev) |

---

## Future Ideas

These features are intentionally out of scope for now but may be explored later:

- **GUI** — A desktop app (`packages/gui`) that wraps the CLI as a subprocess (Electron / Tauri / web-based).
- **File watcher** — Trigger a sync immediately on file changes via `fs.watch`, instead of waiting for the next scheduled cycle.
- **Log rotation** — Automatically rotate or clean up log files by size or age.
- **Multi-directory** — A single process that syncs multiple directories at once.
- **Advanced conflict strategies** — A configurable `"onConflict"` field in `.syncthis.json`:
  - `"stop"` — Current behavior: exit with code 1 (default).
  - `"ask"` — Interactive: show a diff and let the user decide per file (`local` / `remote` / `both`), implemented as a `syncthis resolve` command.
  - `"auto-newest"` — Automatically keep the newer version (timestamp-based).
  - `"auto-both"` — Keep both versions (e.g. `note.md` + `note.conflict.md`).
- **Desktop notifications** — Notify on errors or conflicts.
- **Dry-run mode** — `syncthis start --dry-run` to preview what would happen without making any changes.
- **Custom commit messages** — A template system for auto-commit message formatting.
- **Config migration** — Automatically update `.syncthis.json` on schema changes.
- **Standalone distribution** — Ship without requiring Node.js:
  - *Stage 1:* Homebrew formula with Node as a dependency (`brew install syncthis`).
  - *Stage 2:* Self-contained binaries via `bun build --compile` or Node SEA, built by GitHub Actions for macOS (arm64 + x64), Linux (x64), and Windows (x64).
- **Windows daemon support** — Daemon mode currently supports macOS (launchd) and Linux (systemd). Windows support could be added via Windows Service Manager or [NSSM](https://nssm.cc) (Non-Sucking Service Manager).
- **Daemon service updates** — When syncthis is updated, existing service definitions may still point to the old binary path. A `syncthis daemon update` command or automatic detection in `syncthis daemon status` could handle this.
- **Batch daemon management** — `syncthis daemon start --all` / `syncthis daemon stop --all` to manage all registered daemons at once.
- **Daemon health checks** — Periodic verification that the daemon is actually syncing (not just that the process is alive). Could detect stuck processes or persistent errors.
- **Automated releases** — Conventional Commits + `commit-and-tag-version` (or `release-it`) for SemVer tagging, auto-generated `CHANGELOG.md`, and a GitHub Actions workflow that publishes to npm on tag push (`feat:` → minor, `fix:` → patch, `feat!:` → major).

---

## License

[MIT](LICENSE)