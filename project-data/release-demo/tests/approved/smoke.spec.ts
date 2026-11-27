/**
 * Release Demo smoke test (Task Q6).
 *
 * Needs no credentials, so it runs in CI without a .env file.
 * Requires the demo server: npm run demo:v1
 */

import { test, expect } from '@playwright/test';

test('login page shows the sign-in heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Release Demo' })).toBeVisible();
});
