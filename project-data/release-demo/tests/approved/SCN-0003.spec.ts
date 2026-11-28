// Approved test (DEC-042): approved by Yasas on 2026-11-28 after validation runs 2026-11-28T08-41-13-861Z, 2026-11-28T08-42-00-644Z, 2026-11-28T08-42-47-821Z. Do not edit; re-plan instead.
// Scenario: SCN-0003
// Requirements: DEMO-002 (version 1)
// Plan: plan-20261127T171129Z-333e91
// Explorations: exp-20261127T170734Z-c524de, exp-20261127T170955Z-f3b18f

import { test, expect } from '@playwright/test';

/** A role credential from the environment; fails clearly when it is not set. */
function credential(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}

test('SCN-0003: Prevent login when the username is empty', async ({ page }) => {
  // Expected (DEMO-002): Empty username: login is prevented, the page remains at /, and the message Username is required. is displayed.
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(credential('RELEASE_DEMO_PASSWORD', process.env.RELEASE_DEMO_PASSWORD));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:4310/');
  await expect(page.getByText('Username is required.', { exact: true })).toBeVisible();
});
