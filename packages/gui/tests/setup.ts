// Stub browser globals needed by renderer modules running in Node test environment
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'en' },
  writable: true,
  configurable: true,
});
