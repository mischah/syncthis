# VHS tape for syncthis conflict resolution UI
# Usage: vhs demo/conflict-screenshot.tape
# Requires: brew install vhs

Output demo/conflict-resolution.gif
Output demo/conflict-resolution.png

Set Shell "zsh"
Set FontSize 14
Set Width 960
Set Height 620
Set Padding 20
Set Theme "Relaxed"
Set TypingSpeed 40ms

# Hide the command entry so it looks like a sync process
Hide
Type "FORCE_COLOR=3 npx tsx demo/conflict-screenshot.ts"
Enter
Sleep 3s
Show

# Diff + file-level select menu is now visible
Sleep 4s

# Navigate to "Resolve chunk-by-chunk" (4th option = 3x Down)
Down
Sleep 1s
Down
Sleep 1s
Down
Sleep 1.5s

# Select "Resolve chunk-by-chunk"
Enter
Sleep 1.5s

# Hunk 1/5: "Alice, Bob" → "Alice, Bob, Charlie" — keep remote
Down
Sleep 1s
Enter
Sleep 1.5s

# Hunk 2/5: "- [ ]" → "- [x]" — keep remote
Down
Sleep 1s
Enter
Sleep 1.5s

# Hunk 3/5: added "Draft migration guide" — keep remote
Down
Sleep 1s
Enter
Sleep 1.5s

# Hunk 4/5: "one week" → "two weeks" — keep local
Enter
Sleep 1.5s

# Hunk 5/5: added "Charlie will handle..." — keep remote
Down
Sleep 1s
Enter
Sleep 2s
