import { defineConfig } from '@playwright/test';

// Smoke tests load the built extension into Chromium and hit LIVE Google Maps.
// Not run in CI. Usage: npm run build && npm run e2e
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
