import { resolve, sep } from 'node:path';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function generateServiceName(dirPath: string, label?: string): string {
  if (label) return `com.syncthis.${slugify(label)}`;
  const resolved = resolve(dirPath);
  const segments = resolved.split(sep).filter(Boolean);
  const lastTwo = segments.slice(-2).join('-');
  return `com.syncthis.${slugify(lastTwo)}`;
}
