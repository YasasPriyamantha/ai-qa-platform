// Approved test (DEC-042): approved by Yasas on 2026-11-28 after validation runs 2026-11-28T08-22-08-771Z, 2026-11-28T08-22-19-812Z, 2026-11-28T08-22-28-619Z. Do not edit; re-plan instead.
// Scenario: SCN-0005
// Requirements: REQ-002 (version 1)
// Plan: plan-20261127T102111Z-8b4e28
// Explorations: exp-20261127T093524Z-2d9873, exp-20261127T101141Z-d50936

import { test, expect } from '@playwright/test';

test('SCN-0005: Verify login page controls', async ({ page }) => {
  // Expected (REQ-002): The page at / shows a username input with the placeholder Username, a password input with the placeholder Password, and a button with the accessible name Login.
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
});
