// Approved test (DEC-042): approved by Yasas on 2026-11-28 after validation runs 2026-11-28T17-14-47-283Z, 2026-11-28T17-14-49-736Z, 2026-11-28T17-14-52-034Z. Do not edit; re-plan instead.
// Scenario: SCN-0016
// Requirements: DEMO-004 (version 2)
// Plan: plan-20261128T163845Z-9fad10
// Explorations: exp-20261128T162808Z-53cb93

import { test, expect } from '@playwright/test';

/** A role credential from the environment; fails clearly when it is not set. */
function credential(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}

test('SCN-0016: Do not add a task when the title is empty', async ({ page }) => {
  // Expected (DEMO-004): no task is added and the message Please enter a task title. is displayed.
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(credential('RELEASE_DEMO_USERNAME', process.env.RELEASE_DEMO_USERNAME));
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(credential('RELEASE_DEMO_PASSWORD', process.env.RELEASE_DEMO_PASSWORD));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.goto('/tasks.html');
  await page.getByRole('textbox', { name: 'Task title', exact: true }).fill('');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByText('Please enter a task title.', { exact: true })).toBeVisible();
});
