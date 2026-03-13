# Development

## Setup

```bash
git clone git@github.com:mischah/syncthis.git
cd syncthis
npm install
```

## Useful Scripts

| Command | Description |
|---------|-------------|
| `npm run dev -w packages/cli -- -- --help` | Run CLI in dev mode |
| `npm test` | Run all tests |
| `npm run build` | Build `dist/cli.js` |
| `npm run lint` | Lint and check formatting |
| `npm run lint:fix` | Auto-fix lint and formatting issues |
| `npm run typecheck -w packages/cli` | Type-check without building |

Before finishing work on a feature or fix, all three must pass:

```bash
npm run typecheck
npm run test
npm run lint:fix
```

## Project Structure

```
syncthis/
├── packages/
│   └── cli/
│       ├── src/
│       │   ├── cli.ts           # Entry point, command routing
│       │   ├── commands/
│       │   │   ├── init.ts
│       │   │   ├── resolve.ts   # Interactive conflict resolution
│       │   │   ├── start.ts     # Dual-mode: service (default) + foreground
│       │   │   ├── status.ts
│       │   │   ├── health.ts    # Health check command
│       │   │   └── daemon.ts    # Service management functions
│       │   ├── conflict/
│       │   │   ├── resolver.ts          # Conflict detection & strategy dispatch
│       │   │   ├── interactive.ts       # Interactive prompts & resolution logic
│       │   │   ├── hunk-resolver.ts     # Chunk-by-chunk per-hunk resolution
│       │   │   ├── diff-renderer.ts     # Word-level diff rendering
│       │   │   ├── conflict-filename.ts # Conflict copy filename generation
│       │   └── notify/
│       │       └── desktop.ts           # OS-native desktop notifications (macOS/Linux)
│       │   ├── daemon/
│       │   │   ├── platform.ts  # DaemonPlatform interface + factory
│       │   │   ├── launchd.ts   # macOS launchd implementation
│       │   │   ├── systemd.ts   # Linux systemd implementation
│       │   │   ├── service-name.ts  # Service naming + slugify
│       │   │   └── templates.ts # Plist / unit file generation
│       │   ├── json-output.ts   # JSON response types and output helpers
│       │   ├── config.ts        # Config loading & validation
│       │   ├── sync.ts          # Git sync cycle
│       │   ├── scheduler.ts     # Cron / interval scheduler
│       │   ├── lock.ts          # Process lock management
│       │   ├── health.ts        # Health file read/write
│       │   ├── health-check.ts  # Health status determination
│       │   └── logger.ts        # stdout + file logging
│       └── tests/
│           ├── unit/
│           └── integration/
├── biome.json                   # Linting & formatting
└── tsconfig.base.json
```

## Tech Stack

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
