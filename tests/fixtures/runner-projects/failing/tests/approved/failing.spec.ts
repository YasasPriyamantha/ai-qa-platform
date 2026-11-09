/**
 * Failing fixture test
 *
 * Uses page.setContent() for local browser content without network access.
 * Contains an intentional failing assertion that must not be weakened.
 */

import { test, expect } from '@playwright/test';

test('should fail with intentional assertion', async ({ page }) => {
  // Set local HTML content
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>Failing Test Page</title></head>
      <body>
        <h1>Intentional Failure</h1>
        <p id="status">Actual Value</p>
      </body>
    </html>
  `);

  // This assertion is intentionally incorrect and must fail
  // DO NOT weaken or remove this assertion
  await expect(page.locator('#status')).toHaveText('Expected Different Value');
});
