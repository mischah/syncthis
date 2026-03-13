# How It Works

## Sync cycle

Every sync cycle follows these steps:

```
                Scheduled trigger
                      │
                      ▼
          ┌───────────────────────┐          ┌────────────────────────┐
          │  Rebase in progress?  ├── Yes ──►│      Sync skipped;     │
          └───────────┬───────────┘          │ run `syncthis resolve` │
                     Nope                    └────────────────────────┘
                      │
                      ▼
              ┌───────────────────┐
              │    git status     │
              └───┬───────────┬───┘
                  │           │
               Changes     No changes
                  │           │
                  │           ▼
                  │  ┌───────────────────┐      ┌──────────────────┐
                  │  │ git pull --rebase ├─────►│   Sync paused /  │
                  │  └─────────┬─────────┘ Err  │ retry next cycle │
                  │           OK                └──────────────────┘
                  │            │
                  │            ▼
                  │    ┌───────────────────┐
                  │    │   HEAD changed?   │
                  │    └────┬─────────┬────┘
                  │        Yes       Nope
                  │         │         │
                  │         ▼         ▼
                  │    ┌────────┐  ┌───────┐
                  │    │ Pulled │  │ No-op │
                  │    └────────┘  └───────┘
                  ▼
          ┌───────────────┐
          │  git add -A   │
          └───────┬───────┘
                  │
                  ▼
          ┌───────────────────┐
          │  git commit       │
          └───────┬───────────┘
                  │
                  ▼
          ┌───────────────────┐               ┌──────────────────┐
          │ git pull --rebase ├──── Err ─────►│   Sync paused /  │
          └───────┬───────────┘               │ retry next cycle │
                 OK                           └──────────────────┘
                  │
                  ▼
          ┌──────────────────┐               ┌──────────────────┐
          │  git push        ├─ Net error ──►│   Log warning,   │
          └───────┬──────────┘               │ retry next cycle │
                 OK                          └──────────────────┘
                  │
                  ▼
            ┌──────────┐
            │   Done   │
            └──────────┘
```

**Conflict handling:** When a rebase conflict occurs, syncthis handles it according to the `onConflict` setting. See [Conflict Strategies](./Conflict-Strategies.md).

**Offline support:** If the network is unavailable, the local commit succeeds. Pull and push failures are logged as warnings and retried on the next cycle.

**Single instance:** A `.syncthis.lock` file prevents multiple instances from running against the same directory. Stale locks (left by a crash) are detected automatically by checking the recorded PID.

---

## Service lifecycle

When using `syncthis start`, the OS manages the sync process:

- **macOS:** Registered as a launchd LaunchAgent (`~/Library/LaunchAgents/`). Runs `syncthis start --foreground` internally — launchd handles daemonization.
- **Linux:** Registered as a systemd user unit (`~/.config/systemd/user/`). Uses `systemctl --user` for management.

The OS auto-restarts the service on unexpected exits (crash, rebase conflict after manual resolution). Graceful stops via `syncthis stop` or `SIGTERM` are not restarted.

> **Linux note:** For the service to keep running after logout, user lingering must be enabled: `loginctl enable-linger $USER` (may require sudo). syncthis warns you if this isn't configured.
