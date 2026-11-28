// Approved test (DEC-042): approved by Yasas on 2026-11-28 after validation runs 2026-11-28T16-31-07-789Z, 2026-11-28T16-31-10-884Z, 2026-11-28T16-31-13-693Z. Do not edit; re-plan instead.
// Scenario: SCN-0014
// Requirements: DEMO-005 (version 1)
// Plan: plan-20261128T162937Z-a472e0
// Explorations: exp-20261128T162808Z-53cb93

import { test, expect } from '@playwright/test';

/** A role credential from the environment; fails clearly when it is not set. */
function credential(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}

test('SCN-0014: Sign out from the task list', async ({ page }) => {
  // Expected (DEMO-005): After signing in, when the user clicks Sign out on /tasks.html, the application navigates to / and displays the heading Sign in to Release Demo.
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(credential('RELEASE_DEMO_USERNAME', process.env.RELEASE_DEMO_USERNAME));
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(credential('RELEASE_DEMO_PASSWORD', process.env.RELEASE_DEMO_PASSWORD));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:4310/tasks.html');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:4310/');
  await expect(page.getByRole('heading', { name: 'Sign in to Release Demo', exact: true })).toBeVisible();
});
