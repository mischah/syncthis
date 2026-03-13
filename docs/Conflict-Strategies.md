# Conflict Strategies

Configure how syncthis handles merge conflicts with `onConflict` in `.syncthis.json` or `--on-conflict` on the command line.

```json
{ "onConflict": "auto-both" }
```

```bash
syncthis start --on-conflict ask
```

---

## `auto-both` (default)

Keeps both versions — no data is lost:

- The **original file** retains your local version.
- The **remote version** is saved alongside it as a conflict copy.

Conflict copy filename pattern: `<name>.conflict-YYYY-MM-DDTHH-MM-SS.<ext>`

Examples:
- `note.md` → `note.conflict-2025-03-04T14-30-00.md`
- `archive.tar.gz` → `archive.tar.conflict-2025-03-04T14-30-00.gz`

Both files are committed and pushed, so the conflict copy appears on all devices. Review and delete conflict copies manually when you're done.

---

## `auto-newest`

Automatically keeps the version with the newer Git commit timestamp. The older version is discarded.

- If timestamps are equal, falls back to `auto-both` (creates a conflict copy).
- No user action required.

---

## `stop`

Stops the sync loop immediately and exits with code 1. Resolve the conflict manually:

```bash
cd /path/to/vault
git status            # see conflicting files
# edit files, then:
git add -A
git rebase --continue
syncthis start
```

---

## `ask`

Pauses the sync and prompts you interactively to resolve each conflict:

- **In foreground / TTY mode:** Shows a word-level diff and prompts inline to choose per file: `local` / `remote` / `both` / `chunk-by-chunk` / `abort`. The chunk-by-chunk mode lets you decide individually for each diff hunk.
- **In background service mode (non-TTY):** The rebase is left open. Run `syncthis resolve` in the same directory to complete resolution interactively.

---

## A note on `--ours` / `--theirs` semantics

During `git pull --rebase`, the terms are counterintuitive:

- `--ours` = upstream HEAD (the other device's version, already committed to the branch)
- `--theirs` = REBASE_HEAD (your local commit being replayed)

syncthis handles this internally — the UI labels (`local` / `remote`) match user expectations, not Git's rebase semantics.
