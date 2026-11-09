/**
 * Hanging fixture test
 *
 * Uses page.setContent() for local browser content without network access.
 * Designed to hang indefinitely to test runner-level timeout.
 *
 * Important: Emits FIXTURE_PAGE_READY only AFTER page.setContent() completes,
 * ensuring the browser and test have actually started before the marker appears.
 */

import { test } from '@playwright/test';

test('should hang to test runner timeout', async ({ page }) => {
  // Set local HTML content first
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>Hanging Test Page</title></head>
      <body>
        <h1>Hanging Fixture</h1>
        <p id="status">This test will hang indefinitely</p>
      </body>
    </html>
  `);

  // Verify page loaded successfully before emitting readiness marker
  await page.locator('h1').waitFor({ state: 'visible' });

  // Emit readiness marker to stdout ONLY after page is ready
  // This proves the browser has actually started
  console.log('FIXTURE_PAGE_READY');

  // Disable Playwright's per-test timeout so only the runner timeout applies
  test.setTimeout(0);

  // Intentional indefinite hang - will be terminated by runner timeout
  // Using a simple infinite loop with async delay
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
});
