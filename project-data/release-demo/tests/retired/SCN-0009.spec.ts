// Approved test (DEC-042): approved by Yasas on 2026-11-28 after validation runs 2026-11-28T13-36-11-627Z, 2026-11-28T13-36-15-416Z, 2026-11-28T13-36-18-804Z. Do not edit; re-plan instead.
// Scenario: SCN-0009
// Requirements: DEMO-003 (version 1)
// Plan: plan-20261128T133154Z-f55dd6
// Explorations: exp-20261127T170734Z-c524de, exp-20261127T170955Z-f3b18f

import { test, expect } from '@playwright/test';

/** A role credential from the environment; fails clearly when it is not set. */
function credential(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}

test('SCN-0009: Display the predefined task titles', async ({ page }) => {
  // Expected (DEMO-003): The /tasks.html page displays all three task titles: Prepare release notes, Review test results, and Approve deployment.
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(credential('RELEASE_DEMO_USERNAME', process.env.RELEASE_DEMO_USERNAME));
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(credential('RELEASE_DEMO_PASSWORD', process.env.RELEASE_DEMO_PASSWORD));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.goto('/tasks.html');
  await expect(page.getByText('Prepare release notes', { exact: true })).toBeVisible();
  await expect(page.getByText('Review test results', { exact: true })).toBeVisible();
  await expect(page.getByText('Approve deployment', { exact: true })).toBeVisible();
});
