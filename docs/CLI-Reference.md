# CLI Reference

Complete flag reference for all syncthis commands. For a quick overview, run `syncthis --help` or `syncthis <command> --help`.

---

## `syncthis init`

Initializes a directory for syncing.

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
| `--json` | boolean | Output machine-readable JSON |

`--remote` and `--clone` are mutually exclusive.

---

## `syncthis start`

Installs (if needed) and starts the background sync service.

```bash
syncthis start
syncthis start --path ~/vault
syncthis start --label my-vault
syncthis start --enable-autostart
syncthis start --all
```

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--path` | string | Directory to sync. Default: current directory |
| `--label` | string | Custom service name. Default: derived from directory path |
| `--enable-autostart` | boolean | Start automatically on login. Default: `false` |
| `--cron` | string | Cron expression. Persisted in the service definition. |
| `--interval` | number | Interval in seconds. Persisted in the service definition. |
| `--on-conflict` | string | Conflict strategy: `auto-both`, `auto-newest`, `stop`, `ask`. Default: `auto-both` |
| `--log-level` | string | `debug`, `info`, `warn`, `error`. Default: `info` |
| `--foreground` | boolean | Run in foreground instead of as a service |
| `--no-notify` | boolean | Disable desktop notifications. Default: notifications enabled |
| `--all` | boolean | Start all registered services. Mutually exclusive with `--path`, `--label`, `--foreground`. |
| `--json` | boolean | Output machine-readable JSON. Incompatible with `--foreground`. |

`--cron` and `--interval` are mutually exclusive. CLI flags take priority over `.syncthis.json`.

**Foreground mode:**

```bash
syncthis start --foreground
syncthis start --foreground --cron "*/5 * * * *"
syncthis start --foreground --interval 300
```

Use foreground mode to see live output for debugging, or in environments without a service layer (e.g. Docker containers).

---

## `syncthis stop`

Stops the background sync service. The service stays installed and can be restarted with `syncthis start`.

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--path` | string | Directory to stop. Default: current directory |
| `--all` | boolean | Stop all registered services. Mutually exclusive with `--path`. |
| `--json` | boolean | Output machine-readable JSON. |

---

## `syncthis status`

Shows the current sync status of a directory, including config, Git info, and service state.

**Output includes:**
- Whether `.syncthis.json` exists and is valid.
- Whether a sync process is currently running (with PID).
- Git info: branch, remote URL, number of uncommitted changes, last commit.
- Service status: running/stopped/not installed, label, autostart.
- Health summary: `healthy`, `degraded`, or `unhealthy` with time of last sync.

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--path` | string | Directory to inspect. Default: current directory |
| `--all` | boolean | Show status of all registered services. Mutually exclusive with `--path`. |
| `--json` | boolean | Output machine-readable JSON. |
| `--stale` | boolean | Include services with missing directories. |

---

## `syncthis health`

Shows whether the service is actively syncing — not just that the process is alive.

| Status | Meaning |
|--------|---------|
| `healthy` | Process running, last sync successful, not overdue |
| `degraded` | Process running but sync overdue or consecutive failures |
| `unhealthy` | Process not running, ≥5 consecutive failures, or stuck conflict |

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--path` | string | Directory to check. Default: current directory |
| `--all` | boolean | Show health of all registered services. |
| `--json` | boolean | Output machine-readable JSON. |

---

## `syncthis list`

Lists all registered syncthis services on the system.

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--json` | boolean | Output machine-readable JSON. |

---

## `syncthis logs`

Shows the sync log output.

```bash
syncthis logs                    # Last 50 lines
syncthis logs --follow           # Live output (Ctrl+C to stop)
syncthis logs --lines 100        # Last 100 lines
```

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--follow` | boolean | Stream live output |
| `--lines` | number | Number of lines to show. Default: 50 |
| `--path` | string | Directory. Default: current directory |

---

## `syncthis uninstall`

Stops and completely removes the service from the OS. Your files, `.syncthis.json`, and logs are not deleted.

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--path` | string | Directory to uninstall. Default: current directory |
| `--all` | boolean | Uninstall all registered services. Mutually exclusive with `--path`. |
| `--json` | boolean | Output machine-readable JSON. |

---

## `syncthis resolve`

Interactively resolves a paused rebase conflict left by the `ask` strategy in non-TTY environments.

```bash
syncthis resolve
syncthis resolve --path ~/vault
```

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--path` | string | Directory to resolve. Default: current directory |

---

## Machine-readable output (`--json`)

Pass `--json` to any command (except `resolve` and `logs`) to receive structured JSON. Incompatible with `start --foreground`.

**Success:**
```json
{ "ok": true, "command": "status", "data": { ... } }
```

**Error:**
```json
{ "ok": false, "command": "start", "error": { "message": "Not initialized", "code": "NOT_INITIALIZED" } }
```

Exit code `0` on success, `1` on error.

```bash
syncthis status --json | jq '.data.service.status'
syncthis start --all --json | jq '.data[] | select(.outcome == "failed")'
```
