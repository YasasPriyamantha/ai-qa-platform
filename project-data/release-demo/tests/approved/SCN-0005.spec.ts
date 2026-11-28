// Approved test (DEC-042): approved by Yasas on 2026-11-28 after validation runs 2026-11-28T08-41-13-861Z, 2026-11-28T08-42-00-644Z, 2026-11-28T08-42-47-821Z. Do not edit; re-plan instead.
// Scenario: SCN-0005
// Requirements: DEMO-002 (version 1)
// Plan: plan-20261127T171129Z-333e91
// Explorations: exp-20261127T170734Z-c524de, exp-20261127T170955Z-f3b18f

import { test, expect } from '@playwright/test';

/** A role credential from the environment; fails clearly when it is not set. */
function credential(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}

test('SCN-0005: Prevent login with an incorrect password', async ({ page }) => {
  // Expected (DEMO-002): Incorrect credentials: signing in with the demo account's username and the password wrong-password is prevented, the page remains at /, and the message Username or password is incorrect. is displayed.
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(credential('RELEASE_DEMO_USERNAME', process.env.RELEASE_DEMO_USERNAME));
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:4310/');
  await expect(page.getByText('Username or password is incorrect.', { exact: true })).toBeVisible();
});
