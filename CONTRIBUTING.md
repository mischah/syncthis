# Contributing to syncthis

First off — thank you for considering a contribution! Every bit helps, whether it's a bug report, a typo fix, improved docs, or a brand-new feature. This project is open and welcoming to contributors of all experience levels.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold a kind and respectful environment for everyone.

## How Can I Contribute?

### Reporting Bugs

Found something broken? [Open a bug report](https://github.com/mischah/syncthis/issues/new?template=bug_report.yml). Include the syncthis version, your OS, and ideally the output of `syncthis logs`.

### Suggesting Features

Have an idea? [Open a feature request](https://github.com/mischah/syncthis/issues/new?template=feature_request.yml). Even rough ideas are welcome — we can shape them together.

### Submitting Code

1. **Start with an issue** — For anything beyond a small fix, please open an issue first so we can discuss the approach before you invest time.
2. **Fork & branch** — Create a feature branch from `main` (e.g., `feat/my-change` or `fix/some-bug`).
3. **Make your changes** — See [Development Setup](#development-setup) below.
4. **Validate** — All three must pass before opening a PR:
   ```bash
   npm run typecheck
   npm run test
   npm run lint:fix
   ```
5. **Open a PR** — Reference the related issue and describe what changed.

## Development Setup

```bash
git clone git@github.com:mischah/syncthis.git
cd syncthis
npm install
```

For project structure, available scripts, and the tech stack, see [docs/Development.md](docs/Development.md).

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Keep the subject line concise:

```
feat: add health checks
fix: reject unknown CLI flags
docs: clarify conflict resolution semantics
```

## Questions?

Not sure where to start? Feel free to open an issue and ask — there are no silly questions.
