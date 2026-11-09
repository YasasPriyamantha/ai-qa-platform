/**
 * Passing fixture test
 *
 * Uses page.setContent() for local browser content without network access.
 * Contains a meaningful assertion to verify expected behavior.
 */

import { test, expect } from '@playwright/test';

test('should pass with meaningful assertion', async ({ page }) => {
  // Set local HTML content
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>Passing Test Page</title></head>
      <body>
        <h1>Test Fixture</h1>
        <p id="message">Hello from the passing fixture</p>
        <button id="action">Click Me</button>
      </body>
    </html>
  `);

  // Meaningful assertions
  await expect(page.locator('h1')).toHaveText('Test Fixture');
  await expect(page.locator('#message')).toHaveText('Hello from the passing fixture');
  await expect(page.locator('#action')).toBeVisible();

  // Verify button is clickable
  await page.locator('#action').click();
});
