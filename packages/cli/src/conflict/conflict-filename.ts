import path from 'node:path';

export function formatTimestampForFilename(date: Date): string {
  return date
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '');
}

export function generateConflictFilename(
  filePath: string,
  timestamp: Date,
  existsSync: (p: string) => boolean = () => false,
): string {
  const ts = formatTimestampForFilename(timestamp);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const dir = path.dirname(filePath);

  const buildPath = (counter: number): string => {
    const suffix = counter > 0 ? `-${counter}` : '';
    if (ext) {
      return path.join(dir, `${base}.conflict-${ts}${suffix}${ext}`);
    }
    return path.join(dir, `${base}.conflict-${ts}${suffix}`);
  };

  let counter = 0;
  let candidate = buildPath(counter);
  while (existsSync(candidate)) {
    counter++;
    candidate = buildPath(counter);
  }
  return candidate;
}
