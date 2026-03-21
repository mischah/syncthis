[![npm version](https://img.shields.io/npm/v/syncthis.svg)](https://www.npmjs.com/package/syncthis)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/mischah/syncthis/blob/main/LICENSE)
[![CI](https://github.com/mischah/syncthis/actions/workflows/ci.yml/badge.svg)](https://github.com/mischah/syncthis/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/mischah/syncthis/branch/main/graph/badge.svg)](https://codecov.io/gh/mischah/syncthis)

# syncthis

> Automatic directory synchronization via Git.

Commits, pulls, and pushes your changes on a configurable schedule — no manual `git` commands needed. Runs as a background service managed by your OS.

**Primary use case:** Keep your [Obsidian](https://obsidian.md) vault in sync across multiple devices.

### Smart Conflict Resolution

When the same file is edited on two devices, syncthis detects the conflict and lets you resolve it interactively — with a word-level diff and per-hunk granularity:

![Conflict Resolution](https://raw.githubusercontent.com/mischah/syncthis/main/demo/conflict-resolution.gif)

---

## Table of Contents

- [Quick Start for Obsidian Users](#quick-start-for-obsidian-users)
- [Installation](#installation)
- [Commands](#commands)
- [Configuration](#configuration)
- [Logging](#logging)
- [Documentation](#documentation)

---

## Quick Start for Obsidian Users

> Not a developer? This section is for you. Brand new to Git and the terminal? Follow our [step-by-step guide](https://github.com/mischah/syncthis/blob/main/docs/obsidian-setup-guide.md) instead. If you're comfortable with the terminal, skip to [Installation](#installation).

**What syncthis does:** It runs in the background and automatically commits and syncs your Obsidian vault to a private Git repository (e.g. on GitHub). This keeps your notes in sync across all your devices — without any manual steps.

**Prerequisites:**

1. **Git** installed — check with `git --version` in your terminal. If missing, [download it here](https://git-scm.com/downloads).
2. **Node.js 20+** installed — check with `node --version`. If missing, [download it here](https://nodejs.org).
3. A **private GitHub repository** created for your vault (e.g. `github.com/yourname/my-vault`). See [Creating a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository) — make sure to select **Private**.
4. **SSH access to GitHub** configured — follow [GitHub's SSH guide](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) if you haven't done this yet.

**Setup (one-time, takes ~2 minutes).** Open a terminal (macOS: Terminal.app via Spotlight; Linux: Ctrl+Alt+T) and run:

```bash
# 1. Install syncthis
npm install -g syncthis

# 2. Go to your vault folder
cd /path/to/your/obsidian-vault

# 3. Initialize — links your vault to your GitHub repo
syncthis init --remote git@github.com:yourname/my-vault.git

# 4. Start syncing in the background (every 5 minutes by default)
syncthis start
```

That's it. You can close the terminal — syncthis runs as a background service managed by your OS. On your other devices, repeat steps 2–4 using `--clone` instead of `--remote`:

```bash
# On your second device: clone and start syncing
syncthis init --clone git@github.com:yourname/my-vault.git --path /path/to/vault
syncthis start
```

**Check the status anytime:**

```bash
syncthis status
```

**Stop syncing:**

```bash
syncthis stop
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

```bash
syncthis init --remote git@github.com:user/vault.git   # link existing directory
syncthis init --clone git@github.com:user/vault.git    # clone from remote
```

> For all options run `syncthis init --help` or see the [CLI Reference](https://github.com/mischah/syncthis/blob/main/docs/CLI-Reference.md).

---

### `syncthis start`

Installs (if needed) and starts the background sync service.

```bash
syncthis start                    # current directory
syncthis start --path ~/vault
syncthis start --interval 60      # sync every 60 seconds
syncthis start --all              # start all registered services
syncthis start --foreground       # run attached to terminal (debug)
```

> For all options run `syncthis start --help` or see the [CLI Reference](https://github.com/mischah/syncthis/blob/main/docs/CLI-Reference.md).

---

### `syncthis stop`

Stops the background sync service. The service stays installed and can be restarted with `syncthis start`.

```bash
syncthis stop
syncthis stop --all
```

---

### `syncthis status`

Shows the current sync status: config, Git info, service state, and health summary.

```bash
syncthis status
syncthis status --all
```

---

### `syncthis health`

Shows whether the service is actively syncing — not just that the process is alive.

```bash
syncthis health
syncthis health --all
```

| Status | Meaning |
|--------|---------|
| `healthy` | Process running, last sync successful, not overdue |
| `degraded` | Process running but sync overdue or consecutive failures |
| `unhealthy` | Process not running, ≥5 consecutive failures, or stuck conflict |

---

### `syncthis list`

Lists all registered syncthis services on the system.

```bash
syncthis list
```

---

### `syncthis logs`

Shows the sync log output.

```bash
syncthis logs                    # Last 50 lines
syncthis logs --follow           # Live output (Ctrl+C to stop)
```

---

### `syncthis uninstall`

Stops and completely removes the service from the OS. Your files and logs are not deleted.

```bash
syncthis uninstall
syncthis uninstall --all
```

---

### `syncthis resolve`

Interactively resolves a paused rebase conflict (used with the `ask` conflict strategy in background mode).

```bash
syncthis resolve
```

---

### Machine-readable output (`--json`)

Pass `--json` to any command (except `resolve` and `logs`) for structured JSON output — useful for scripting.

```bash
syncthis status --json | jq '.data.service.status'
```

---

## Configuration

`syncthis init` creates a `.syncthis.json` in the synced directory:

```json
{
  "remote": "git@github.com:user/vault.git",
  "branch": "main",
  "cron": "*/5 * * * *",
  "interval": null,
  "onConflict": "auto-both"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `remote` | string | — | Remote repository URL |
| `branch` | string | `"main"` | Branch to sync |
| `cron` | string \| null | `"*/5 * * * *"` | Cron expression |
| `interval` | number \| null | `null` | Interval in seconds (≥ 10) |
| `onConflict` | string | `"auto-both"` | Conflict strategy: `auto-both`, `auto-newest`, `stop`, `ask` |

Exactly one of `cron` or `interval` must be set. CLI flags always override the config file.

**Conflict strategies:** `auto-both` (default) keeps both versions as a conflict copy. See [Conflict Strategies](https://github.com/mischah/syncthis/blob/main/docs/Conflict-Strategies.md) for full details.

---

## Logging

Logs are written to both stdout and `.syncthis/logs/syncthis.log` in the synced directory. Control verbosity with `--log-level debug|info|warn|error`.

Use `syncthis logs` or `syncthis logs --follow` as a shortcut to read them.

---

## Documentation

- [CLI Reference](https://github.com/mischah/syncthis/blob/main/docs/CLI-Reference.md) — All commands and flags
- [Conflict Strategies](https://github.com/mischah/syncthis/blob/main/docs/Conflict-Strategies.md) — Full conflict strategy docs
- [How It Works](https://github.com/mischah/syncthis/blob/main/docs/How-It-Works.md) — Sync cycle diagram, service lifecycle
- [Development](https://github.com/mischah/syncthis/blob/main/docs/Development.md) — Dev setup, project structure, tech stack
- [Obsidian Setup Guide](https://github.com/mischah/syncthis/blob/main/docs/obsidian-setup-guide.md) — Step-by-step for new users

---

## Desktop App

A desktop GUI is also available — see the [syncthis repository](https://github.com/mischah/syncthis) for details.

---

## License

[MIT](https://github.com/mischah/syncthis/blob/main/LICENSE)
