// Approved test (DEC-042): approved by Yasas on 2026-11-28 after validation runs 2026-11-28T13-36-11-627Z, 2026-11-28T13-36-15-416Z, 2026-11-28T13-36-18-804Z. Do not edit; re-plan instead.
// Scenario: SCN-0011
// Requirements: DEMO-004 (version 1)
// Plan: plan-20261128T133154Z-f55dd6
// Explorations: exp-20261127T170734Z-c524de, exp-20261127T170955Z-f3b18f

import { test, expect } from '@playwright/test';

/** A role credential from the environment; fails clearly when it is not set. */
function credential(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}

test('SCN-0011: Submit an empty task title', async ({ page }) => {
  // Expected (DEMO-004): Empty task title: no task is added and the message Task title is required. is displayed.
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(credential('RELEASE_DEMO_USERNAME', process.env.RELEASE_DEMO_USERNAME));
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(credential('RELEASE_DEMO_PASSWORD', process.env.RELEASE_DEMO_PASSWORD));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.goto('/tasks.html');
  await page.getByRole('textbox', { name: 'Task title', exact: true }).fill('');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByText('Task title is required.', { exact: true })).toBeVisible();
});
