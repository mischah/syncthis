export function shortenPath(p: string): string {
  return p.replace(/^(\/Users\/[^/]+|\/home\/[^/]+)/, '~');
}

export function sanitizeRemoteUrl(url: string): string {
  return url.replace(/^https?:\/\/[^@\s]+@/, 'https://');
}

export function shortenRemoteUrl(url: string): string {
  return sanitizeRemoteUrl(url)
    .replace(/^https?:\/\//, '')
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/\.git$/, '');
}
