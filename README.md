[![npm version](https://img.shields.io/npm/v/syncthis.svg)](https://www.npmjs.com/package/syncthis)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/mischah/syncthis/actions/workflows/ci.yml/badge.svg)](https://github.com/mischah/syncthis/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/mischah/syncthis/branch/main/graph/badge.svg)](https://codecov.io/gh/mischah/syncthis)

# syncthis

> Automatic directory synchronization via Git.

Commits, pulls, and pushes your changes on a configurable schedule — no manual `git` commands needed.

**Primary use case:** Keep your [Obsidian](https://obsidian.md) vault in sync across multiple devices.

---

## Table of Contents

- [Quick Start for Obsidian Users](#quick-start-for-obsidian-users)
- [Installation](#installation)
- [Commands](#commands)
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

# 4. Start syncing (every 5 minutes by default)
syncthis start
```

That's it. Leave the terminal window open — syncthis will sync your vault automatically. On your other devices, repeat steps 2–4 using `--clone` instead of `--remote`:

```bash
# On your second device: clone and start syncing
syncthis init --clone git@github.com:yourname/my-vault.git --path /path/to/vault
syncthis start
```

**Check the status anytime:**

```bash
syncthis status
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

### `syncthis start`

Starts the sync loop.

```bash
syncthis start
syncthis start --path /home/user/my-vault
syncthis start --cron "*/5 * * * *"
syncthis start --interval 300
```

- Loads and validates `.syncthis.json`. Exits with an error if not found.
- Creates a lock file to prevent multiple instances on the same directory.
- Runs an initial sync cycle immediately.
- Starts the scheduler.
- Handles `SIGINT`/`SIGTERM` (Ctrl+C) with a graceful shutdown.

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--path` | string | Directory to sync. Default: current directory |
| `--cron` | string | Cron expression. Overrides config. |
| `--interval` | number | Interval in seconds. Overrides config. |
| `--log-level` | string | `debug`, `info`, `warn`, `error`. Default: `info` |

`--cron` and `--interval` are mutually exclusive. CLI flags take priority over `.syncthis.json`.

---

### `syncthis status`

Shows the current sync status.

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

## How It Works

Every sync cycle follows these steps:

```
Scheduled trigger (cron or interval)
          │
          ▼
  ┌───────────────────┐
  │  git status       │──── No changes ──────────────────────► Skip (no commit)
  └────────┬──────────┘
           │ Changes detected
           ▼
  ┌───────────────────┐
  │  git add -A       │
  └────────┬──────────┘
           │
           ▼
  ┌──────────────────────────────────────────────┐
  │  git commit -m                               │
  │  "sync: auto-commit 2025-02-20T14:30:00      │
  │   (3 files changed)"                         │
  └────────┬─────────────────────────────────────┘
           │
           ▼
  ┌───────────────────────┐
  │  git pull --rebase    │──── Conflict ────────────────────► ❌ Sync paused
  └────────┬──────────────┘                                        Exit code 1
           │ OK                                              (manual resolution
           ▼                                                       required)
  ┌───────────────────┐
  │  git push         │──── Network error ───────────────────► ⚠️  Log warning,
  └────────┬──────────┘                                           retry next cycle
           │ OK
           ▼
        ✅ Done
```

**Conflict handling:** syncthis never resolves conflicts automatically. If a rebase conflict occurs, the sync loop stops and exits with code 1. Resolve the conflict manually (`git rebase --continue`), then restart with `syncthis start`.

**Offline support:** If the network is unavailable, the local commit succeeds. The pull and push failures are logged as warnings, and the loop continues. Everything syncs on the next successful cycle.

**Single instance:** A `.syncthis.lock` file prevents multiple instances from running against the same directory. Stale locks (left by a crash) are detected automatically by checking the recorded PID.

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
│       │   │   └── status.ts
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

These features are intentionally out of scope for v1 but may be explored later:

- **GUI** — A desktop app (`packages/gui`) that wraps the CLI as a subprocess (Electron / Tauri / web-based).
- **File watcher** — Trigger a sync immediately on file changes via `fs.watch`, instead of waiting for the next scheduled cycle.
- **Log rotation** — Automatically rotate or clean up log files by size or age.
- **Multi-directory** — A single process that syncs multiple directories at once.
- **Advanced conflict strategies** — A configurable `"onConflict"` field in `.syncthis.json`:
  - `"stop"` — Current v1 behavior: exit with code 1 (default).
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
- **Daemon mode** — Run syncthis as a background process detached from the terminal, managed by the OS service layer (launchd on macOS, systemd on Linux, Windows Service Manager). Would include `syncthis daemon start/stop/status` commands and auto-start on login. Currently, `syncthis start` requires an open terminal session.
- **Automated releases** — Conventional Commits + `commit-and-tag-version` (or `release-it`) for SemVer tagging, auto-generated `CHANGELOG.md`, and a GitHub Actions workflow that publishes to npm on tag push (`feat:` → minor, `fix:` → patch, `feat!:` → major).

---

## License

[MIT](LICENSE)
