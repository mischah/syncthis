# syncthis GUI — Feature Specification

> **Status:** Ready
> **Scope:** Desktop GUI for syncthis (Electron, macOS + Linux)
> **Replaces:** N/A (new feature)
> **Depends on:** CLI v0.11.0+ (all commands, `--json` flag, health checks)

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Architecture](#2-architecture)
  - [2.1 App Model](#21-app-model)
  - [2.2 Process Architecture](#22-process-architecture)
  - [2.3 Monorepo Structure](#23-monorepo-structure)
  - [2.4 CLI Bundling](#24-cli-bundling)
  - [2.5 IPC Layer](#25-ipc-layer)
  - [2.6 State Management](#26-state-management)
  - [2.7 Internationalization (i18n)](#27-internationalization-i18n)
  - [2.8 Dependencies](#28-dependencies)
- [3. Design System](#3-design-system)
  - [3.1 Visual Direction](#31-visual-direction)
  - [3.2 Typography](#32-typography)
  - [3.3 Color Palette](#33-color-palette)
  - [3.4 Icons](#34-icons)
  - [3.5 Spacing & Layout](#35-spacing--layout)
  - [3.6 Component Library](#36-component-library)
- [4. Views](#4-views)
  - [4.1 Tray Popover](#41-tray-popover)
  - [4.2 Detail View](#42-detail-view)
  - [4.3 Conflict Resolution](#43-conflict-resolution)
  - [4.4 Setup Wizard](#44-setup-wizard)
  - [4.5 Settings](#45-settings)
- [5. Navigation & View Transitions](#5-navigation--view-transitions)
- [6. GitHub OAuth Integration](#6-github-oauth-integration)
- [7. Git Credential Management](#7-git-credential-management)
- [8. Notifications](#8-notifications)
- [9. Update Check](#9-update-check)
- [10. Service Management](#10-service-management)
- [11. First Launch & Empty States](#11-first-launch--empty-states)
- [12. Error Handling & User-Facing Messages](#12-error-handling--user-facing-messages)
- [13. Packaging & Distribution](#13-packaging--distribution)
- [14. Platform Considerations](#14-platform-considerations)
- [15. Implementation Phases](#15-implementation-phases)
- [16. Acceptance Criteria](#16-acceptance-criteria)
- [17. Open Questions & Post-v1](#17-open-questions--post-v1)

---

## 1. Overview

### Goal

A desktop application that replaces the CLI for non-technical users. Primary audience: Obsidian users who want their notes synced across devices without touching a terminal.

The GUI must feel invisible when everything works (tray icon, background sync) and helpful when something needs attention (conflicts, errors, setup).

### Terminology

The GUI uses **"folder"** (not "vault" or "directory") in all user-facing text. This keeps the tool agnostic — it works for Obsidian vaults, Logseq graphs, or plain Markdown directories.

Internal code and IPC channels may use `directory` or `dir` for consistency with the CLI codebase.

### Core Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| App model | Hybrid: tray icon + dashboard window | 95% background, 5% intervention |
| Framework | Electron | Shared Node.js runtime with CLI |
| UI stack | React + shadcn/ui | Themeable component library |
| State management | React Context + IPC | Small state surface |
| Packaging | electron-forge | Official tooling, DMG + AppImage/deb |
| Platforms | macOS + Linux | Matches CLI. No Windows. |
| Terminology | "Folder" | Tool-agnostic |
| Git auth (GUI) | HTTPS + GitHub OAuth token | No SSH for target audience |
| CLI integration | Direct import + subprocess for daemons | Best of both worlds |

---

## 2. Architecture

### 2.1 App Model

**Tray icon** (macOS menu bar / Linux system tray) is the primary touchpoint. Clicking opens a **popover** with folder status and quick actions. A button in the popover opens the **dashboard window** for detailed management.

The dashboard window does **not** appear in the Dock (macOS) or taskbar (Linux) when closed. The app lives in the tray until the user explicitly opens the dashboard.

Tray icon states (aggregated across all folders):

| Icon state | Meaning |
|------------|---------|
| Default (idle) | All folders healthy, no active sync |
| Syncing (animated) | At least one sync cycle running |
| Warning (badge) | At least one folder degraded |
| Error (badge) | At least one folder unhealthy or has unresolved conflict |
| Update dot | New version available (see §9) |

Implementation: use Electron `Tray` with Iconoir cloud icons (`cloud-check`, `cloud-sync`, `cloud` + badge variants) exported as template images (macOS) and standard icons (Linux). Animated sync state via swapping icon frames on a timer. See §3.4 for the full icon state table.

### 2.2 Process Architecture

```
┌─────────────────────────────────────────────────────┐
│  Main Process (Node.js)                             │
│                                                     │
│  ├── Tray management (icon, popover window)         │
│  ├── Dashboard window management                    │
│  ├── CLI module integration (direct import)         │
│  │   ├── config.ts    (read/write .syncthis.json)   │
│  │   ├── health.ts    (read health.json)            │
│  │   ├── sync.ts      (sync cycle logic)            │
│  │   ├── lock.ts      (process lock)                │
│  │   └── conflict/    (diff + resolution logic)     │
│  ├── Daemon management (CLI subprocess)             │
│  │   └── syncthis start|stop|uninstall --json       │
│  ├── GitHub OAuth token storage                     │
│  ├── Git credential helper management               │
│  ├── Notification dispatch (Electron Notification)  │
│  └── Update checker (GitHub Releases API)           │
│                                                     │
│  IPC via contextBridge (typed channels)             │
├─────────────────────────────────────────────────────┤
│  Renderer Process (React)                           │
│                                                     │
│  ├── Tray Popover (BrowserWindow, frameless)        │
│  └── Dashboard (BrowserWindow)                      │
│      ├── Detail View                                │
│      ├── Conflict Resolution                        │
│      ├── Setup Wizard                               │
│      └── Settings                                   │
└─────────────────────────────────────────────────────┘
```

**Direct import vs. subprocess:** The Main Process imports CLI modules (`config.ts`, `health.ts`, `sync.ts`, conflict resolution logic) directly as TypeScript/JS modules. This gives typed access without JSON serialization overhead.

**Exception:** Daemon management (`start`, `stop`, `uninstall`) uses the CLI as a child process (`syncthis start --json`) because these commands interact with OS service layers (launchd/systemd) and need to run as the bundled CLI binary that the service definitions point to.

### 2.3 Monorepo Structure

```
syncthis/
├── packages/
│   ├── cli/              # Existing CLI (unchanged)
│   │   ├── src/
│   │   └── package.json
│   ├── gui/              # New: Electron app
│   │   ├── src/
│   │   │   ├── main/         # Electron Main Process
│   │   │   │   ├── main.ts
│   │   │   │   ├── tray.ts
│   │   │   │   ├── windows.ts
│   │   │   │   ├── ipc.ts           # IPC handler registration
│   │   │   │   ├── oauth.ts         # GitHub OAuth flow
│   │   │   │   ├── credentials.ts   # Git credential helper
│   │   │   │   ├── updater.ts       # Update check logic
│   │   │   │   └── cli-bridge.ts    # Subprocess calls for daemon mgmt
│   │   │   ├── renderer/     # React app
│   │   │   │   ├── App.tsx
│   │   │   │   ├── components/
│   │   │   │   ├── views/
│   │   │   │   │   ├── DetailView.tsx
│   │   │   │   │   ├── ConflictResolution.tsx
│   │   │   │   │   ├── SetupWizard.tsx
│   │   │   │   │   └── Settings.tsx
│   │   │   │   ├── context/
│   │   │   │   │   └── AppContext.tsx
│   │   │   │   └── hooks/
│   │   │   ├── popover/      # Separate entry for tray popover window
│   │   │   │   └── Popover.tsx
│   │   │   └── preload/
│   │   │       └── preload.ts    # contextBridge exposure
│   │   ├── resources/        # App icons, tray icons
│   │   ├── forge.config.ts   # electron-forge config
│   │   └── package.json
│   └── shared/           # New: shared types
│       ├── src/
│       │   ├── config.types.ts
│       │   ├── health.types.ts
│       │   ├── ipc.types.ts      # IPC channel definitions
│       │   └── json-output.types.ts
│       └── package.json
├── biome.json
└── tsconfig.base.json
```

`packages/shared` extracts type definitions that both CLI and GUI depend on: `SyncthisConfig`, `HealthStatus`, JSON output shapes, and IPC channel type contracts. The CLI re-exports from shared; existing imports stay stable.

### 2.4 CLI Bundling

The GUI ships as a standalone app. The user never runs `npm install`.

On first launch (and after updates), the app copies the bundled CLI binary to a stable path:

```
~/.syncthis/bin/syncthis
```

All OS service definitions (launchd plist / systemd unit) point to this path. This decouples the service from the app bundle location — moving or updating the `.app` / AppImage does not break running services.

**Update flow:** When the app starts, it compares the bundled CLI version with the installed one at `~/.syncthis/bin/syncthis`. If different, it replaces the binary and restarts affected services.

**CLI availability:** The GUI does *not* add `~/.syncthis/bin` to the user's `$PATH`. The binary exists solely for service definitions. Users who also want the CLI install it separately via npm.

### 2.5 IPC Layer

Typed IPC using Electron's `contextBridge` + `ipcRenderer.invoke`. No additional libraries.

All channels are defined in `packages/shared/src/ipc.types.ts` as a single type map:

```typescript
// packages/shared/src/ipc.types.ts

export interface IpcChannels {
  // Folder management
  'folders:list': { args: void; result: FolderSummary[] };
  'folders:detail': { args: { dirPath: string }; result: FolderDetail };
  'folders:add': { args: InitOptions; result: FolderSummary };
  'folders:remove': { args: { dirPath: string }; result: void };

  // Service management (delegates to CLI subprocess)
  'service:start': { args: { dirPath: string }; result: JsonOutput };
  'service:stop': { args: { dirPath: string }; result: JsonOutput };
  'service:restart': { args: { dirPath: string }; result: JsonOutput };
  'service:uninstall': { args: { dirPath: string }; result: JsonOutput };
  'service:sync-now': { args: { dirPath: string }; result: void };

  // Config
  'config:read': { args: { dirPath: string }; result: SyncthisConfig };
  'config:write': { args: { dirPath: string; config: SyncthisConfig }; result: void };

  // Health (direct module import, polled)
  'health:status': { args: { dirPath: string }; result: HealthStatus };
  'health:all': { args: void; result: HealthStatus[] };

  // Conflict resolution
  'conflict:list-files': { args: { dirPath: string }; result: ConflictFile[] };
  'conflict:get-diff': { args: { dirPath: string; filePath: string }; result: FileDiff };
  'conflict:resolve-file': {
    args: { dirPath: string; filePath: string; choice: 'local' | 'remote' | 'both' };
    result: void;
  };
  'conflict:resolve-hunk': {
    args: { dirPath: string; filePath: string; hunkIndex: number; choice: 'local' | 'remote' };
    result: void;
  };
  'conflict:abort': { args: { dirPath: string }; result: void };
  'conflict:finalize': { args: { dirPath: string }; result: void };

  // GitHub OAuth
  'github:start-auth': { args: void; result: { verificationUri: string; userCode: string } };
  'github:poll-auth': { args: void; result: { token: string } | null };
  'github:list-repos': { args: void; result: GitHubRepo[] };
  'github:status': { args: void; result: { connected: boolean; username?: string } };
  'github:disconnect': { args: void; result: void };

  // App
  'app:open-folder-picker': { args: void; result: string | null };
  'app:reveal-in-file-manager': { args: { dirPath: string }; result: void };
  'app:check-update': { args: void; result: UpdateInfo | null };
  'app:get-version': { args: void; result: string };

  // Logs (streaming via event, not invoke)
  'logs:subscribe': { args: { dirPath: string }; result: void };
  'logs:unsubscribe': { args: { dirPath: string }; result: void };
}

// Main → Renderer events (pushed, not requested)
export interface IpcEvents {
  'health:changed': HealthStatus;
  'conflict:detected': { dirPath: string; fileCount: number };
  'logs:line': { dirPath: string; line: string };
  'update:available': UpdateInfo;
  'service:state-changed': { dirPath: string; status: ServiceStatus };
}
```

**Preload script** exposes a typed API object:

```typescript
// preload.ts
contextBridge.exposeInMainWorld('syncthis', {
  invoke: <K extends keyof IpcChannels>(
    channel: K,
    args: IpcChannels[K]['args']
  ): Promise<IpcChannels[K]['result']> =>
    ipcRenderer.invoke(channel, args),

  on: <K extends keyof IpcEvents>(
    event: K,
    callback: (data: IpcEvents[K]) => void
  ): () => void => {
    const handler = (_: unknown, data: IpcEvents[K]) => callback(data);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
});
```

### 2.6 State Management

React Context with a single `AppContext` provider. No external state library.

```typescript
interface AppState {
  folders: FolderSummary[];        // List of all managed folders
  activeFolderPath: string | null; // Currently selected folder
  view: 'detail' | 'conflict' | 'setup' | 'settings';
  githubConnected: boolean;
  updateAvailable: UpdateInfo | null;
}
```

The context provider initializes by calling `folders:list` and `health:all` on mount, then subscribes to `health:changed` and `service:state-changed` events for live updates.

Polling interval for health data: **10 seconds**. This matches the CLI's minimum sync interval and keeps the UI responsive without excessive IPC traffic.

### 2.7 Internationalization (i18n)

All user-facing strings are loaded from translation files — never hardcoded in components. v1 ships with English only, but the architecture supports adding languages later without code changes.

**Approach:** Simple JSON lookup, no heavy i18n framework.

```
packages/gui/src/renderer/i18n/
├── en.json          # English (default, ships with v1)
└── index.ts         # Loader + typed lookup function
```

```typescript
// en.json (excerpt)
{
  "status.healthy": "Healthy",
  "status.degraded": "Degraded",
  "status.unhealthy": "Unhealthy",
  "status.synced_ago": "Synced {time} ago",
  "status.service_stopped": "Service stopped",
  "action.sync_now": "Sync now",
  "action.start": "Start syncing",
  "action.stop": "Stop syncing",
  "action.add_folder": "Add folder",
  "conflict.title": "Conflicting changes",
  "conflict.resolve_prompt": "{count} file has conflicting changes. Click to resolve.",
  "conflict.keep_local": "Keep local",
  "conflict.keep_remote": "Keep remote",
  "conflict.keep_both": "Keep both",
  "wizard.connect_github": "Connect your GitHub account",
  "wizard.choose_repo": "Choose a repository",
  "wizard.choose_folder": "Choose local folder",
  "wizard.done_title": "Your folder is syncing"
}

// index.ts
import en from './en.json';
type TranslationKey = keyof typeof en;
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  let str = en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, String(v));
  return str;
}
```

**Rules:**
- Every string visible to the user goes through `t()`.
- Interpolation uses `{variable}` placeholders.
- Error messages (§12) are also in the translation file.
- UI labels in ASCII art diagrams in this spec represent the English translation keys — implementations must use `t()`.

### 2.8 Dependencies

All dependencies in `packages/gui/package.json` are **pinned to exact versions** (no `^` or `~` prefixes), consistent with the CLI's dependency strategy. This ensures reproducible builds.

```jsonc
// Example — exact versions, no ranges
{
  "dependencies": {
    "electron": "33.2.0",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "iconoir-react": "7.10.0"
  }
}
```

---

## 3. Design System

### 3.1 Visual Direction

**Reference:** Linear — clean, minimal, generous whitespace, subtle borders, restrained color use.

**Principles:**

- **Quiet by default.** The UI recedes when everything is working. Status is communicated through subtle indicators, not loud colors.
- **Warm, not cold.** Neutral palette leans warm (stone/sand undertones rather than blue-gray). The app should feel approachable, not clinical.
- **Density over decoration.** Information-dense where needed (detail view, conflict diff), but achieved through typography hierarchy and spacing — not through boxes, cards, or visual weight.
- **Transitions are functional.** Subtle fade/slide transitions between views for orientation, not for flair. Duration: 150ms ease-out.

**Light & dark mode:** Follows system preference via `prefers-color-scheme`. Both modes are first-class — not one adapted from the other.

### 3.2 Typography

**Font:** Inter — loaded locally, bundled with the app (no network request).

**Weight scale:**

| Weight | Name | Usage |
|--------|------|-------|
| 300 | Light | Timestamps, metadata, secondary annotations, relative times ("2m ago") |
| 400 | Regular | Body text, labels, descriptions, table content |
| 400 *italic* | Regular Italic | Hints, placeholder text, empty state messages ("No conflicts to resolve"), disabled states — used sparingly |
| 500 | Medium | Section headings, active navigation items, primary button labels |
| 600 | Semi-Bold | Page titles, important numbers (sync count, file count), folder names in the sidebar |

**Size scale (rem-based, 1rem = 14px base):**

| Token | Size | Usage |
|-------|------|-------|
| `text-xs` | 11px | Badges, tiny labels |
| `text-sm` | 12px | Secondary text, timestamps, metadata |
| `text-base` | 14px | Body text, labels, table content |
| `text-lg` | 16px | Section headings, folder names |
| `text-xl` | 20px | Page titles |

**Line height:** 1.5 for body text, 1.3 for headings.

**Monospace:** `Cascadia Code` (bundled) for diff views, file paths, cron expressions, and log output. Sized at 13px.

### 3.3 Color Palette

Warm neutral base with semantic colors for status only.

**Neutral ramp (warm stone):**

| Token | Light mode | Dark mode | Usage |
|-------|-----------|-----------|-------|
| `bg-primary` | `#FFFFFF` | `#1A1918` | Main background |
| `bg-secondary` | `#F9F8F6` | `#212120` | Sidebar, popover bg, cards |
| `bg-tertiary` | `#F2F0ED` | `#2A2928` | Hover states, active items |
| `bg-elevated` | `#FFFFFF` | `#2A2928` | Elevated surfaces (popover, modals) |
| `border-default` | `#E8E6E1` | `#333230` | Default borders |
| `border-subtle` | `#F0EEEA` | `#2A2928` | Subtle separators |
| `text-primary` | `#1A1918` | `#E8E6E1` | Primary text |
| `text-secondary` | `#6F6D66` | `#9C9A93` | Secondary text, labels |
| `text-tertiary` | `#A3A19A` | `#6F6D66` | Placeholder, disabled |

**Semantic colors (muted, not saturated):**

| Token | Light mode | Dark mode | Usage |
|-------|-----------|-----------|-------|
| `status-healthy` | `#3D8B5E` | `#5AB87A` | Healthy, synced, success |
| `status-healthy-bg` | `#EEF6F1` | `#1E2B22` | Healthy badge background |
| `status-warning` | `#C08A2E` | `#D4A03C` | Degraded, overdue |
| `status-warning-bg` | `#FBF4E4` | `#2B2518` | Warning badge background |
| `status-error` | `#C4422B` | `#E05A42` | Unhealthy, conflict, error |
| `status-error-bg` | `#FCF0ED` | `#2E1F1B` | Error badge background |
| `accent` | `#4A7BDB` | `#6B9AEF` | Links, focus rings, primary buttons |
| `accent-bg` | `#EDF2FC` | `#1E2433` | Accent badge background |

**Usage rules:**

- Neutral ramp for all structural elements (backgrounds, borders, text).
- Semantic colors **only** for status indicators, badges, and actionable highlights. Never as decorative color.
- No colored backgrounds on large surfaces. Status color appears in small badges, dots, and icon tints.
- Focus rings use `accent` with 2px offset.

### 3.4 Icons

**Icon set:** [Iconoir](https://iconoir.com) — regular weight (1.5px stroke). One set for both UI and tray.

**Sizing:**

| Context | Size |
|---------|------|
| Inline with text | 16px |
| Buttons, list items | 20px |
| Empty states | 32px |
| Tray icon | 22px (macOS) / 24px (Linux) |

**Icon color:** Inherits `text-secondary` by default. Status icons use the corresponding semantic color. Active/hover icons use `text-primary`.

**Key icons (Iconoir names):**

| Concept | Icon |
|---------|------|
| Folder | `folder` |
| Sync / refresh | `refresh-double` |
| Healthy | `check-circle` |
| Warning | `warning-triangle` |
| Error | `x-mark-circle` |
| Conflict | `git-pull-request-closed` |
| Settings | `settings` |
| Add | `plus` |
| GitHub | `github` |
| Start service | `play` |
| Stop service | `stop` |
| Logs | `terminal` |
| Open in file manager | `open-new-window` |
| Schedule / clock | `clock` |
| Branch | `git-branch` |

**Tray icons (Iconoir, exported as template images):**

| State | Icon | Detail |
|-------|------|--------|
| Idle / healthy | `cloud-check` | Default resting state |
| Syncing | `cloud-sync` | Arrows animated via frame rotation |
| Warning (degraded) | `cloud` + warning badge | Small dot, bottom-right |
| Error / conflict | `cloud` + error badge | Small dot, bottom-right |
| Update available | `cloud-check` + update dot | Subtle dot, top-right |

On macOS, tray icons are template images (monochrome, macOS auto-adapts to menu bar appearance). Badges are baked into the icon variants — not overlaid at runtime. This means 5 separate template images.

### 3.5 Spacing & Layout

**Spacing scale (4px base):**

| Token | Value |
|-------|-------|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-5` | 20px |
| `space-6` | 24px |
| `space-8` | 32px |
| `space-10` | 40px |
| `space-12` | 48px |

**Layout dimensions:**

- **Popover:** 360px wide, max-height 480px, border-radius 12px.
- **Dashboard window:** min 720×480, default 900×600, resizable.
- **Sidebar** (visible at ≥2 folders): 220px fixed width, full height, left edge.
- **Content area:** fills remaining space, max content width 640px centered, `space-8` horizontal padding.
- **Section spacing:** `space-8` between major sections, `space-4` between related items.

**Border radius:**

| Element | Radius |
|---------|--------|
| Buttons, inputs | 6px |
| Cards, popovers, modals | 12px |
| Badges, pills | 9999px (full round) |

### 3.6 Component Library

**shadcn/ui** with custom theme matching §3.3 colors. Key components used:

`Button` (primary, secondary, ghost, destructive), `Input`, `Select`, `Switch`, `Slider`, `Badge` (healthy, warning, error, neutral), `Dialog`, `Tooltip`, `Separator`, `ScrollArea`, `Tabs`, `Progress`.

**Custom components (not from shadcn):**

- `StatusDot` — 8px circle, animated pulse when syncing.
- `FolderRow` — compact row for popover and sidebar (name, path, status badge, last sync time).
- `DiffView` — word-level diff renderer, adapted from CLI's `diff-renderer.ts`.
- `HunkPicker` — per-hunk resolution UI, adapted from CLI's `hunk-resolver.ts`.
- `StepIndicator` — wizard step progress (dots + labels).

---

## 4. Views

### 4.1 Tray Popover

A frameless `BrowserWindow` anchored to the tray icon. Width 360px, max-height 480px.

**Layout:**

```
┌──────────────────────────────────────┐
│  syncthis               [gear] [·v]  │  Header: app name, settings shortcut, update dot
├──────────────────────────────────────┤
│  ● Notes                   2m ago ↻  │  Folder row: status dot, name, last sync, sync-now
│    ~/Documents/Notes                 │  Path (light 300, truncated from left)
├──────────────────────────────────────┤
│  ● Work                    5m ago ↻  │
│    ~/Work/notes                      │
├──────────────────────────────────────┤
│  ▲ Personal             conflict  ⚠  │  Conflict state: warning icon, "conflict" label
│    ~/Personal/vault                  │
│    ┌────────────────────────────┐    │
│    │  1 conflict — Resolve now  │    │  Inline action banner (accent-bg)
│    └────────────────────────────┘    │
├──────────────────────────────────────┤
│  + Add folder          Open ↗        │  Footer: add folder, open dashboard
└──────────────────────────────────────┘
```

**Folder row details:**

- **Status dot** (`StatusDot`): colored per health (green/yellow/red). Pulses during active sync.
- **Folder name:** medium (500), from directory basename.
- **Last sync:** light (300), relative time ("2m ago", "just now", "1h ago").
- **Sync-now button** (↻ `refresh-double`): triggers immediate cycle. Disabled while syncing or if stopped.
- **Path:** light (300), `text-secondary`, truncated from left with `…` if needed.
- Clicking the folder row opens the dashboard Detail View for that folder.

**Conflict banner:** Appears inline below the folder when a rebase is paused. Clicking "Resolve now" opens the dashboard Conflict Resolution view.

**Footer:**

- "+ Add folder" opens the dashboard Setup Wizard.
- "Open" (with `open-new-window`) opens the dashboard window.

**Behavior:**

- Opens on tray icon click (left click macOS, left or right on Linux).
- Closes on click outside, Escape, or tray icon click again.
- Anchored below tray icon (macOS) or above system tray (Linux).
- Re-reads health data on every open.

### 4.2 Detail View

Main view in the dashboard. Shows one folder's complete status and controls.

**Single-folder layout (no sidebar):**

```
┌──────────────────────────────────────────────────────┐
│                         Notes                [+ Add]  │  Sticky header
├──────────────────────────────────────────────────────┤
│                                                      │
│  Status                                              │
│  ● Healthy                            Synced 2m ago  │  Badge + relative time (light 300)
│                                                      │
│  ──────────────────────────────────────────────────  │
│                                                      │
│  Schedule         every 2 minutes                    │  Key-value grid
│  Branch           main                               │
│  Remote           github.com/user/Notes              │
│  Conflict mode    Keep both versions                 │
│  Last commit      Updated shopping list  ·  14:32    │
│                                                      │
│  ──────────────────────────────────────────────────  │
│                                                      │
│  Activity                                            │
│  14:35  ✓  Synced · 3 files changed                  │  Compact event log
│  14:30  ✓  Synced · no changes                       │
│  14:25  ✓  Synced · 1 file changed, pushed           │
│  14:20  ⚠  Push failed · network unreachable         │
│  14:15  ✓  Synced · 2 files changed                  │
│                                                      │
│  ──────────────────────────────────────────────────  │
│                                                      │
│  [▶ Start]  [↻ Sync now]  [Open folder]  [Settings]  │  Action bar
│  [Uninstall service]                                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Multi-folder layout (≥2 folders, sidebar appears):**

```
┌───────────────────┬──────────────────────────────────┐
│  syncthis         │                                  │
│                   │  (Detail View content as above)   │
│  ● Notes      ✓   │                                  │
│  ● Work       ✓   │                                  │
│  ▲ Personal   ⚠   │                                  │
│                   │                                  │
│                   │                                  │
│  ─────────────    │                                  │
│  + Add folder     │                                  │
│  ⚙ Settings       │                                  │
└───────────────────┴──────────────────────────────────┘
```

Sidebar: 220px fixed width. Folder list with name + status icon. Active folder highlighted with `bg-tertiary`. Footer: "+ Add folder" and "Settings" (global).

Sidebar transition: slides in (200ms) when a second folder is added, slides out when returning to one folder.

**Status block:**

- `Badge` with semantic color (healthy/warning/error).
- "Synced 2m ago" in light (300). Service stopped: *"Service stopped"* in italic, `text-tertiary`.
- If conflict: error badge "Conflict" + "Resolve" button (accent).

**Info grid:**

- Two-column key-value layout. Labels in `text-secondary`, values in `text-primary`.
- Remote URL stripped to `github.com/user/Notes` (full URL in tooltip).
- Cron shown in human-readable form: `*/5 * * * *` → "every 5 minutes". Raw in tooltip.
- Conflict mode shown as human label: `auto-both` → "Keep both versions".

**Activity log:**

- Compact list, newest first. Each row: timestamp (light 300, `text-secondary`), status icon, description.
- Scrollable, last 20 events default. "Show full log" opens scrollable sheet.
- Data: parsed from `.syncthis/logs/syncthis.log`.

**Action bar:**

- Start / Stop: toggles based on service state. Stop requires confirmation dialog.
- "Sync now": triggers immediate cycle. Disabled when stopped.
- "Open folder": `shell.openPath` → Finder / Nautilus.
- "Settings": navigates to per-folder settings.
- "Uninstall service": destructive, requires confirmation.

### 4.3 Conflict Resolution

Full-screen view within the dashboard (replaces Detail View when active). Adapts the CLI's `syncthis resolve` flow to a visual interface.

**Layout:**

```
┌──────────────────────────────────────────────────────────┐
│  ← Back to Notes           Resolving conflicts           │
│                            2 of 4 files resolved         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ■ shopping-list.md                       resolved  │  │  File list
│  │ ■ weekly-plan.md                         resolved  │  │
│  │ ● meeting-notes.md                       current → │  │
│  │ ○ project-ideas.md                       pending   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  meeting-notes.md                                        │
│  ──────────────────────────────────────────────────────  │
│                                                          │
│  - The weekly meeting is scheduled for Tuesday           │  Diff view (word-level)
│  + The weekly meeting is scheduled for Wednesday         │
│                                                          │
│    ## Action Items                                       │
│  - Review Q3 budget by Friday                            │
│  + Review Q3 budget by Thursday                          │
│  + Send follow-up email to team                          │
│                                                          │
│  ──────────────────────────────────────────────────────  │
│                                                          │
│  [Keep local]  [Keep remote]  [Keep both]  [By chunk]   │  Per-file actions
│                                                          │
│  [Abort — undo all resolutions]                          │
└──────────────────────────────────────────────────────────┘
```

**File list:**

- Compact list at top. Status per file: resolved (■ `status-healthy`), current (● `accent`), pending (○ `text-tertiary`).
- Clickable to jump between files.
- Progress: "2 of 4 files resolved" + `Progress` bar.

**Diff view (`DiffView` component):**

- Word-level unified diff. Font: `Cascadia Code` 13px.
- Removed: `status-error-bg` background, strikethrough.
- Added: `status-healthy-bg` background.
- Unchanged: normal.
- Scrollable, with line numbers.
- Diff logic recycled from CLI's `diff-renderer.ts` — `diff` npm package for data, React component for rendering.

**Per-file actions:**

- **Keep local** — local version wins, remote changes discarded.
- **Keep remote** — remote version wins, local changes discarded.
- **Keep both** — local wins, remote saved as `.conflict-TIMESTAMP.ext`.
- **By chunk** — enters chunk-by-chunk mode.

**Chunk-by-chunk mode (`HunkPicker` component):**

Diff splits into individual hunks. Each hunk shows local/remote with "Keep local" / "Keep remote" buttons. Sequential progress: "Hunk 3 of 5". Recycled from CLI's `hunk-resolver.ts`.

**Abort:**

Ghost destructive button. Confirmation dialog: "This undoes all resolutions and returns the folder to its conflicted state." Calls `git rebase --abort`.

**Finalization:**

After all files resolved, "Complete" button appears (accent, prominent). Continues rebase + pushes. On success: toast "Conflicts resolved", transitions to Detail View. On failure: error message (§12).

### 4.4 Setup Wizard

Multi-step flow for adding a new folder. Full dashboard content, no sidebar during setup.

**Steps:**

```
  ●───────○───────○───────○
 Connect   Choose   Local    Done
 GitHub    repo     folder
```

**Step 1 — Connect GitHub** (skipped if already connected):

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│            Connect your GitHub account               │
│                                                      │
│  syncthis syncs your folder with a private GitHub    │
│  repository. Connect your account to get started.    │
│                                                      │
│           [Connect with GitHub]                      │
│                                                      │
│  ─── or ──────────────────────────────────────────   │
│                                                      │
│  Repository URL                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ https://github.com/user/repo.git              │  │
│  └────────────────────────────────────────────────┘  │
│  Enter an HTTPS URL to skip GitHub sign-in.          │
│                                                      │
│                                     [Next →]         │
└──────────────────────────────────────────────────────┘
```

- Primary path: "Connect with GitHub" → Device Flow (§6).
- Fallback: manual HTTPS URL for non-GitHub hosts.
- SSH URL entered: inline hint — *"syncthis desktop works best with HTTPS URLs. SSH is supported in the CLI."*
- Validation: `git ls-remote` on the URL before proceeding. Inline error on failure.

**Step 2 — Choose repository** (GitHub connected path only, skipped if manual URL):

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  Choose a repository                                 │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 🔍 Filter repositories…                       │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ○  Notes                           private · 2d     │
│  ○  work-vault                      private · 1w     │
│  ○  recipes                         private · 3mo    │
│                                                      │
│  Only private repositories are shown.                │
│                                                      │
│                           [← Back]    [Next →]       │
└──────────────────────────────────────────────────────┘
```

- Lists private repos via GitHub API. Filter input for search.
- Shows name, visibility, last push (relative).
- Private repos only (notes in a public repo is almost certainly a mistake). Public available via manual URL fallback.
- Radio selection, single repo.

**Step 3 — Choose local folder:**

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  Choose local folder                                 │
│                                                      │
│  ○ Clone into a new folder                           │
│    The repository contents will be downloaded.       │
│                                                      │
│  ○ Use an existing folder                            │
│    Connect a folder that already has your files.     │
│                                                      │
│  Location                                            │
│  ┌──────────────────────────────────────┐            │
│  │ ~/Documents/Notes                   │ [Browse]   │
│  └──────────────────────────────────────┘            │
│                                                      │
│  Sync schedule                                       │
│  Every [ 5 ▼] minutes                                │
│                                                      │
│  What to do on conflicts                             │
│  [ Keep both versions  ▼]                            │
│  Both versions are saved — nothing is lost.          │
│                                                      │
│                           [← Back]    [Set up →]     │
└──────────────────────────────────────────────────────┘
```

- Clone vs. existing: radio toggle. Maps to `--clone` / `--remote`.
- Location: input + "Browse" (native `dialog.showOpenDialog`, directory mode). Default for clone: `~/Documents/<reponame>`.
- Schedule: dropdown — 1 / 2 / 5 / 10 / 15 / 30 minutes / 1 hour. Maps to `interval`. Default: 5.
- Conflict strategy: dropdown with human labels + one-line descriptions:
  - "Keep both versions" (`auto-both`) — *Both versions are saved — nothing is lost.*
  - "Keep newest" (`auto-newest`) — *The newer version wins automatically.*
  - "Ask me" (`ask`) — *Pause syncing and let you decide.*
  Default: "Keep both versions".
  Note: The CLI's `stop` strategy is not offered in the GUI — it requires manual terminal-based resolution, which conflicts with the GUI's target audience. `ask` covers the "let me decide" use case with a visual resolution flow.

**Step 4 — Done:**

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│              ✓  Your folder is syncing                │
│                                                      │
│  Notes is now syncing every 5 minutes with           │
│  github.com/user/Notes.                              │
│                                                      │
│  syncthis runs in the background — you can close     │
│  this window. Look for the icon in your menu bar.    │
│                                                      │
│           [Done]       [Add another folder]           │
└──────────────────────────────────────────────────────┘
```

- "Done" → Detail View for the new folder.
- "Add another folder" → restarts wizard.
- At this point: `syncthis init` + `syncthis start` have run, service is active.

### 4.5 Settings

Two scopes: per-folder (edits `.syncthis.json`) and app-global (stored in `app.getPath('userData')`).

Accessed via sidebar footer or Detail View action bar. `Tabs` component: one tab per folder + "App" tab.

**Per-folder tab:**

```
┌──────────────────────────────────────────────────────┐
│  Settings                                            │
│                                                      │
│  [Notes]  [Work]  [App]                              │  Tabs
│  ──────────────────────────────────────────────────  │
│                                                      │
│  Remote                                              │
│  https://github.com/user/Notes.git           [Copy]  │  Read-only
│                                                      │
│  Branch                                              │
│  ┌──────────────────────────────────────────────┐    │
│  │ main                                         │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  Sync schedule                                       │
│  ○ Every [ 5 ▼] minutes                             │
│  ○ Cron expression  ┌──────────────────────────┐     │
│                     │ */5 * * * *              │     │
│                     └──────────────────────────┘     │
│                                                      │
│  On conflict                                         │
│  [ Keep both versions  ▼]                            │
│  Both versions are saved — nothing is lost.          │
│                                                      │
│  Notifications                                       │
│  Notify on sync events             [────●]  on       │
│                                                      │
│  Autostart                                           │
│  Start service on login            [────●]  on       │
│                                                      │
│  Service label                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │ documents-notes                              │    │  Optional
│  └──────────────────────────────────────────────┘    │
│  Used for the OS service name. Leave empty for auto. │
│                                                      │
│                                          [Save]      │
└──────────────────────────────────────────────────────┘
```

**Field mapping to `.syncthis.json`:**

| UI field | Config key | Type | Notes |
|----------|-----------|------|-------|
| Remote | `remote` | string | Read-only after init |
| Branch | `branch` | string | Text input |
| Schedule (minutes) | `interval` | number | Dropdown, sets `cron: null` |
| Schedule (cron) | `cron` | string | Text input with validation, sets `interval: null` |
| On conflict | `onConflict` | enum | Dropdown: `auto-both`, `auto-newest`, `ask` (no `stop` in GUI) |
| Notifications | `notify` | boolean | Switch |
| Autostart | `autostart` | boolean | Switch |
| Service label | `daemonLabel` | string | Text input, optional |

**Save behavior:**

- Writes `.syncthis.json` via `config:write`.
- Schedule, conflict, or autostart changed → restarts service. Toast: "Settings saved — service restarted."
- Cosmetic changes only → saves without restart. Toast: "Settings saved."
- Validation errors: inline, red border + error text. Save disabled while invalid.

**App settings tab:**

```
┌──────────────────────────────────────────────────────┐
│  [Notes]  [Work]  [App]                              │
│  ──────────────────────────────────────────────────  │
│                                                      │
│  General                                             │
│  Launch on login                   [────●]  on       │
│                                                      │
│  ──────────────────────────────────────────────────  │
│                                                      │
│  Defaults for new folders                            │
│  Sync schedule        Every [ 5 ▼] minutes           │
│  On conflict          [ Keep both versions  ▼]       │
│                                                      │
│  ──────────────────────────────────────────────────  │
│                                                      │
│  GitHub                                              │
│  Connected as mischah               [Disconnect]     │
│                                                      │
│  ──────────────────────────────────────────────────  │
│                                                      │
│  About                                               │
│  syncthis v0.11.0                                    │
└──────────────────────────────────────────────────────┘
```

**App settings storage:** JSON file in `app.getPath('userData')/settings.json`.

```typescript
interface AppSettings {
  launchOnLogin: boolean;
  defaults: {
    interval: number;
    onConflict: ConflictStrategy;
  };
  github: {
    token?: string;     // Encrypted via safeStorage
    username?: string;
  };
  dismissedUpdateVersion?: string;
}
```

---

## 5. Navigation & View Transitions

**Routing:** State-based via `AppContext.view`, no URL router.

**Transitions:**

| From | To | Trigger | Animation |
|------|-----|---------|-----------|
| Detail | Conflict | Click "Resolve" | Slide left, 150ms |
| Conflict | Detail | "Back" or finalize | Slide right, 150ms |
| Detail | Settings | Click "Settings" | Slide left, 150ms |
| Settings | Detail | "Back" or sidebar folder click | Slide right, 150ms |
| Any | Setup Wizard | Click "Add folder" | Fade, 150ms |
| Setup Wizard | Detail | Wizard complete | Fade, 150ms |

**Window close:** Hides dashboard, does not quit. Tray stays active. Reopen restores last view + folder.

**Keyboard shortcuts:**

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+,` | Open settings |
| `Cmd/Ctrl+R` | Sync now (active folder) |
| `Cmd/Ctrl+N` | Add new folder |
| `Cmd/Ctrl+W` | Close dashboard window |
| `Cmd/Ctrl+Q` | Quit app entirely |
| `Escape` | Close popover / go back |
| `Cmd/Ctrl+1..9` | Switch to folder 1..9 (sidebar visible) |

---

## 6. GitHub OAuth Integration

### Device Flow

Uses GitHub's [Device Authorization Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow). No redirect URI needed, works well in desktop apps.

**Flow:**

1. User clicks "Connect with GitHub".
2. Main Process: `POST https://github.com/login/device/code` with `client_id` + `scope=repo`.
3. GitHub returns `device_code`, `user_code`, `verification_uri`.
4. GUI shows user code, opens verification URI in default browser.
5. User enters code on GitHub and authorizes.
6. Main Process polls `POST https://github.com/login/oauth/access_token` with `device_code` every `interval` seconds.
7. Token received and stored.

**UI during authorization:**

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  Enter this code on GitHub:                          │
│                                                      │
│              A1B2-C3D4                                │  Monospace, large, easy to read
│                                                      │
│  A browser window has opened. Paste the code there   │
│  to connect your GitHub account.                     │
│                                                      │
│  [Copy code]           [Open GitHub again]           │
│                                                      │
│  Waiting for authorization…                          │  Spinner
└──────────────────────────────────────────────────────┘
```

**Token storage:**

- macOS: `Electron.safeStorage.encryptString` → stored in app settings JSON.
- Linux: same (`safeStorage` uses the system keyring if available, falls back to a machine-specific key).

**OAuth scope:** `repo` (list private repos, clone, push).

**GitHub App:** Requires a registered OAuth App with Device Flow enabled. `client_id` hardcoded; `client_secret` not needed for device flow.

---

## 7. Git Credential Management

When the GUI initializes a folder via HTTPS, Git needs credentials for pull/push.

**Approach:** Per-folder Git credential helper that returns the stored OAuth token.

On init, the Main Process:

1. Writes a credential script to `~/.syncthis/credentials/<folder-hash>.sh`:
   ```bash
   #!/bin/sh
   echo "username=x-access-token"
   echo "password=<token>"
   ```
2. Sets the helper on the repo: `git config credential.helper '!~/.syncthis/credentials/<hash>.sh'`
3. Script updated in-place when the token is refreshed.

**Security:** Script is chmod 700 (owner-only). This matches how `gh` CLI and VS Code handle Git credentials.

**Non-GitHub remotes:** If the user entered a manual URL (no OAuth), Git's default credential prompting is used. The GUI does not manage credentials for non-GitHub hosts.

---

## 8. Notifications

### Native OS Notifications

Via Electron `Notification` API. Shown when dashboard is closed.

| Event | Title | Body |
|-------|-------|------|
| Conflict detected | "Conflict in Notes" | "1 file has conflicting changes. Click to resolve." |
| Service crashed | "Sync stopped for Notes" | "The background service stopped unexpectedly." |
| ≥3 consecutive failures | "Sync issues with Notes" | "Sync has failed 3 times. Check your connection." |
| Update available | "syncthis update available" | "Version X.Y.Z is available." |

**Not notified:** Successful syncs, single push failures, user-initiated start/stop.

Clicking a notification opens the relevant dashboard view. Respects per-folder `notify` setting.

### Tray Status

Passive notification channel:

- Icon badge/color reflects worst-case across all folders.
- Popover shows per-folder status.
- Conflict banners in popover are the primary call-to-action.

---

## 9. Update Check

On launch and every 24 hours: fetch `https://api.github.com/repos/mischah/syncthis/releases/latest`. Semver-compare tag with app version.

**If update available:**

1. Tray icon: subtle update dot.
2. Dashboard: dismissible banner — "syncthis X.Y.Z is available — [Download]".
3. One-time native notification.

**Dismiss:** Persists version in `AppSettings.dismissedUpdateVersion`. New version re-triggers.

**Download:** Opens GitHub release page in browser. Manual install. Full auto-update is post-v1.

**On failure:** Silent skip. No error shown.

---

## 10. Service Management

The GUI manages OS services via the bundled CLI binary as subprocess with `--json`.

| GUI action | CLI command |
|------------|-------------|
| Start syncing | `syncthis start --path <dir> --json` |
| Stop syncing | `syncthis stop --path <dir> --json` |
| Restart | stop + start |
| Uninstall | `syncthis uninstall --path <dir> --json` |
| Sync now | Direct import: call `runSyncCycle()` |

Subprocess for service management because launchd/systemd commands need the binary at `~/.syncthis/bin/syncthis`. Direct import for sync-now (faster, no subprocess).

**Flags passed on start:**

```bash
syncthis start \
  --path /Users/michael/Notes \
  --interval 120 \
  --on-conflict ask \
  --log-level info \
  --json
```

`--enable-autostart` added if `autostart: true`.

**Monitoring:** Health polled every 10s (§2.6). PID changes detected → `service:state-changed` event.

---

## 11. First Launch & Empty States

### First Launch

1. Copy CLI binary to `~/.syncthis/bin/syncthis`.
2. Open dashboard directly to Setup Wizard.
3. Tray popover: *"No folders syncing yet"* + "Add folder" button.

### Returning Launch (No Folders)

Dashboard opens to Setup Wizard. Popover shows empty state.

### Returning Launch (With Folders)

Dashboard opens to Detail View of most recently active folder. Popover shows folder list.

### Empty States

**Activity log (new folder):** *"No sync activity yet — first sync will run shortly."* (400 italic, `text-secondary`)

**Conflict resolution (no conflicts):** `git-pull-request-closed` icon 32px `text-tertiary`, *"No conflicts to resolve"* (400 italic), "Back to folder" link.

---

## 12. Error Handling & User-Facing Messages

### Principles

The target audience does not understand Git. Every error must be human-readable with a clear action. No Git commands or stack traces in the default view.

Format: **Title** (medium 500) + **one sentence** (regular 400) explaining what happened and what to do. Technical details in collapsed "Show details" section.

### Error Translation Table

| Git/system error | Title | Message |
|---|---|---|
| `ENOENT: .syncthis.json` | Folder not initialized | This folder isn't set up for syncing yet. |
| Network error on pull | Can't reach the server | Check your internet connection. Syncing resumes automatically. |
| Push rejected | Sync conflict | Changes were made elsewhere. This usually resolves on the next cycle. |
| Rebase conflict | Conflicting changes | The same file was edited on two devices. [Resolve now] |
| Service not running | Sync service stopped | The background service isn't running. [Start syncing] |
| Service crash | Sync service crashed | Restarted automatically. Check the activity log for details. |
| Auth failure | Repository access denied | Check that the repository exists and your account has access. |
| Invalid cron | Invalid schedule | Use a format like "*/5 * * * *" (every 5 minutes). |
| Disk full | Not enough disk space | Free up space and syncing will resume. |
| Lock file exists | Already syncing | Another sync process is running. Usually a previous sync still in progress. |

### Confirmation Dialogs

| Action | Title | Body | Confirm |
|--------|-------|------|---------|
| Stop service | Stop syncing? | Pauses background syncing. Your files are not affected. | Stop syncing |
| Uninstall | Remove sync service? | Stops syncing and removes the service. Your files are not deleted. | Remove service |
| Abort conflict | Abort resolution? | Undoes all resolutions and returns to the conflicted state. | Abort |
| Disconnect GitHub | Disconnect GitHub? | You'll need to reconnect to add new folders. Existing folders keep syncing. | Disconnect |

---

## 13. Packaging & Distribution

### Build Tool

electron-forge:

| Platform | Format | Maker |
|----------|--------|-------|
| macOS | `.dmg` | `@electron-forge/maker-dmg` |
| Linux | `.AppImage` | `@electron-forge/maker-appimage` |
| Linux | `.deb` | `@electron-forge/maker-deb` |

### CI Pipeline

Triggered on Git tag push (unified version with CLI):

1. Build CLI.
2. Build GUI (includes CLI).
3. `electron-forge make` for macOS (arm64 + x64) and Linux (x64).
4. Upload binaries as assets to the existing GitHub Release.
5. CLI published to npm via `np` (existing flow).

### Code Signing

- **macOS v1:** Unsigned. Gatekeeper workaround documented in README (right-click → Open). Code signing post-v1.
- **Linux:** No signing required.

### App Metadata

| Field | Value |
|-------|-------|
| App name | syncthis |
| Bundle ID | `com.syncthis.desktop` |
| Category | Productivity |

### Local Development Build

The GUI README (`packages/gui/README.md`) must document how to build locally:

```bash
# Install dependencies
npm install

# Run in development mode (hot-reload)
npm run dev -w packages/gui

# Build for macOS (current architecture)
npm run make -w packages/gui

# Build outputs in packages/gui/out/make/
```

The `make` command produces platform-native output for the current OS (DMG on macOS, AppImage/deb on Linux). Cross-compilation is not supported — macOS builds require macOS, Linux builds require Linux. CI handles both.

---

## 14. Platform Considerations

### macOS

- **Tray icon:** Iconoir cloud icons exported as template images, 22×22 @1x / 44×44 @2x. 5 variants (idle, syncing, warning, error, update). macOS auto-adapts light/dark.
- **Popover:** Anchored below tray (`tray.getBounds()`).
- **Dock:** Hidden by default (`app.dock.hide()`). Shown when dashboard open, hidden on close.
- **Login item:** `app.setLoginItemSettings({ openAtLogin: true })`.
- **Daemon:** launchd LaunchAgent.

### Linux

- **Tray icon:** 24×24px. Works on GNOME (with AppIndicator extension), KDE, XFCE. May not appear on stock GNOME without extension — user can still launch from application menu.
- **Popover:** Positioned above system tray. Falls back to screen center if tray bounds unavailable.
- **Login item:** `app.setLoginItemSettings` → `.desktop` file in `~/.config/autostart/`.
- **Daemon:** systemd user unit.
- **User lingering:** If not configured, one-time dismissible warning: *"For syncing after logout, run: `loginctl enable-linger $USER`"*.

---

## 15. Implementation Phases

### Phase 1 — Electron Skeleton + Tray + Detail View

**Goal:** App starts, tray icon works, dashboard shows folder status. Requires a pre-initialized folder (via CLI) for testing.

**Scope:**

- Electron app scaffold with electron-forge. All dependencies pinned to exact versions (§2.8).
- Tray icon with popover (folder list, status).
- Dashboard: Detail View (health, info grid, action bar).
- IPC: `folders:list`, `folders:detail`, `health:status`, `health:all`, `service:start`, `service:stop`, `service:sync-now`.
- CLI bundling to `~/.syncthis/bin/syncthis`.
- `packages/shared` with extracted types.
- Design system: CSS variables, Inter + Cascadia Code bundled, Iconoir icons, shadcn/ui theme.
- i18n setup: translation file (`en.json`), `t()` function, all UI strings loaded via `t()` (§2.7).
- Light + dark mode.

**Not included:** Setup wizard, OAuth, conflict resolution, settings UI, notifications, update check.

**Acceptance criteria:**

- App starts, tray icon appears, popover opens/closes correctly.
- Folder pre-initialized via CLI: Detail View shows correct status, health, git info.
- Start/stop/sync-now work.
- All user-facing strings come from `en.json` via `t()` — zero hardcoded strings in components.
- Light/dark follows system.
- Builds for macOS (DMG) and Linux (AppImage).

### Phase 2 — Settings + Activity Log

**Goal:** Edit per-folder settings via form, see sync history.

**Scope:**

- Settings view: per-folder form, save → write config + restart service.
- App settings tab: launch on login, defaults.
- Activity log: parsed from log file, shown in Detail View.
- Sidebar for ≥2 folders.
- Keyboard shortcuts.

**Acceptance criteria:**

- Changing interval saves to `.syncthis.json` and restarts service.
- Activity log shows events with correct icons/timestamps.
- Sidebar appears/disappears at 2/1 folder boundary.
- Launch on login works on both platforms.

### Phase 3 — Setup Wizard + GitHub OAuth

**Goal:** Non-technical user goes from zero to syncing without a terminal.

**Scope:**

- GitHub OAuth Device Flow, token storage, repo listing.
- Setup Wizard: all 4 steps.
- Git credential helper management.
- Manual URL fallback.
- First-launch experience.
- Empty states.

**Acceptance criteria:**

- Complete wizard: folder initialized, service running, files sync.
- Token stored securely, survives restart.
- HTTPS push/pull works with credential helper.
- Manual URL works for non-GitHub.
- First launch → wizard; subsequent → Detail View.

### Phase 4 — Conflict Resolution

**Goal:** Visual conflict resolution without a terminal.

**Scope:**

- Conflict Resolution view: file list, diff, per-file buttons, chunk-by-chunk.
- `DiffView` + `HunkPicker` components (recycled from CLI logic).
- Abort + finalization flows.
- Conflict detection: notification + tray badge + popover banner.

**Acceptance criteria:**

- 3 conflicting files: resolvable with local/remote/both/chunk-by-chunk.
- Chunk-by-chunk: pick per hunk.
- Abort returns to pre-conflict state.
- After resolution: service resumes.
- Native notification on conflict detection.

### Phase 5 — Notifications + Update Check + Polish

**Goal:** Production-ready.

**Scope:**

- Native notifications (conflict, crash, persistent errors, update).
- Update check (GitHub Releases API, banner + tray dot).
- Linux platform fixes (tray, lingering warning).
- Error message coverage (§12 complete).
- Popover polish (animation, positioning).
- Performance (startup < 2s, memory).
- README: GUI install instructions, screenshots.

**Acceptance criteria:**

- Notifications work for conflict + crash.
- Update banner appears on new release.
- All confirmation dialogs correct.
- Works on macOS (arm64 + x64) and Linux (x64).
- Cold start to tray icon < 2s.

---

## 16. Acceptance Criteria

Global criteria across all phases:

- User never needs a terminal for any GUI-covered operation.
- All user-facing text uses "folder" — never "vault" or "directory".
- All user-facing strings loaded via `t()` from translation files (§2.7) — no hardcoded strings in components.
- All user-facing text in English for v1.
- Light and dark mode work on macOS and Linux.
- No user-visible Git jargon ("rebase", "HEAD", "fast-forward"). Branch names and remote URLs are acceptable.
- Conflict strategy dropdown offers only `auto-both`, `auto-newest`, `ask` — never `stop`.
- Closing dashboard does not stop services.
- Quitting app prompts: "Sync services will continue running in the background."
- All destructive actions require confirmation.
- All errors show user-friendly messages with clear actions.
- IPC calls >500ms show a loading indicator.

---

## 17. Open Questions & Post-v1

### Open Questions

- **Popover implementation:** BrowserWindow (full design control) vs. native Tray menu (simpler, less flexible). Recommendation: BrowserWindow.
- **Log format:** Activity log parses `.syncthis/logs/syncthis.log`. Format changes break the parser. Consider structured JSON lines in a future CLI version.
- **Token refresh:** GitHub tokens can expire. Detect 401 during push → re-auth flow. Low priority if tokens are long-lived.
- **Electron version:** Pin to one that ships Node ≥ 20 (Electron 30+).
- **CLI + GUI dual-use:** If a user has both the global CLI (via npm) and the GUI installed, both can manage services. Service definitions point to whichever binary was used for `syncthis start`. Needs a clear policy: does the GUI take ownership of CLI-created services? Does the CLI warn if a GUI-managed service exists? To be resolved during implementation.

### Post-v1

| Feature | Notes |
|---------|-------|
| Auto-update (download + install) | Requires macOS code signing. `electron-updater` + GitHub Releases. |
| Windows support | Needs Windows service manager in CLI first. |
| File watcher trigger | Immediate sync on `fs.watch` changes. |
| Onboarding tooltips | First-time highlights of key UI elements. |
| Conflict history | Log of past conflicts and resolutions. |
| Multiple GitHub accounts | Work + personal. |
| GitLab / Gitea OAuth | For non-GitHub hosts. |
| Drag-and-drop setup | Drag folder onto app to start init. |
| Menu bar inline text | Show "Synced 2m ago" in macOS menu bar. |
| Localization | Translation files (§2.7) are ready. Add language switcher in App Settings + community translations. |
