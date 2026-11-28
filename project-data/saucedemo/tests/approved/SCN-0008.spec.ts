// Approved test (DEC-042): approved by Yasas on 2026-11-28 after validation runs 2026-11-28T13-34-49-423Z, 2026-11-28T13-34-57-459Z, 2026-11-28T13-35-01-577Z. Do not edit; re-plan instead.
// Scenario: SCN-0008
// Requirements: REQ-003 (version 2)
// Plan: plan-20261128T133107Z-0953ba
// Explorations: exp-20261127T101141Z-d50936

import { test, expect } from '@playwright/test';

/** A role credential from the environment; fails clearly when it is not set. */
function credential(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}

test('SCN-0008: Add Sauce Labs Backpack to the cart', async ({ page }) => {
  // Expected (REQ-003): After the standard user opens /inventory-item.html?id=4, the product page for Sauce Labs Backpack, and clicks Add to cart once, the cart badge displays 1.
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(credential('SAUCEDEMO_STANDARD_USER_USERNAME', process.env.SAUCEDEMO_STANDARD_USER_USERNAME));
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(credential('SAUCEDEMO_STANDARD_USER_PASSWORD', process.env.SAUCEDEMO_STANDARD_USER_PASSWORD));
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.goto('/inventory-item.html?id=4');
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await expect(page.getByText('1', { exact: true })).toBeVisible();
});
