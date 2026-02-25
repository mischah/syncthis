# syncthis

Monorepo (npm workspaces) for automatic Git directory synchronization.

- `packages/cli` — CLI tool (published to npm as "syncthis")
- `packages/gui` — GUI (placeholder, not yet developed)

## Tech Stack

TypeScript (ESM), Biome (linter + formatter), tsdown (bundler), Vitest (tests).

## Workflow

Before finishing work on a feature or fix, run from the repo root:

```sh
npm run typecheck
npm run test
npm run lint:fix
```

All three must pass.

## Commits

Do NOT create commits. After successful validation, suggest a Conventional Commit message (english) for the user to use. Keep the subject line concise. Body is optional — only add it when the "why" isn't obvious from the subject.

Examples: `fix: reject unknown CLI flags`, `feat: add status command`, `chore: release v0.2.1`
