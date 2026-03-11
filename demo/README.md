# Demo Assets

GIF and PNG for the README conflict resolution showcase.

## Regenerate

```bash
brew install vhs   # one-time, also installs ttyd + ffmpeg
vhs demo/conflict-screenshot.tape
```

Output: `demo/conflict-resolution.gif` (committed) and `demo/conflict-resolution.png` (gitignored).

## Files

| File | Description |
|------|-------------|
| `conflict-screenshot.ts` | Standalone script that renders the conflict UI with sample data |
| `conflict-screenshot.tape` | VHS tape definition — drives the terminal recording |
| `conflict-resolution.gif` | Generated GIF, embedded in the root README |
