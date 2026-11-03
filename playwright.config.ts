/**
 * Platform-owned Playwright configuration
 *
 * This is the one and only Playwright config for the platform.
 * It will be completed in Task 1.3 with environment-driven project selection.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Configuration will be implemented in Task 1.3
  testDir: './tests/fixtures/runner-projects/passing/tests/approved',
  retries: 0
});
