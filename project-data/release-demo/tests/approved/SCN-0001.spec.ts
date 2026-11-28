// Approved test (DEC-042): approved by Yasas on 2026-11-28 after validation runs 2026-11-28T08-41-13-861Z, 2026-11-28T08-42-00-644Z, 2026-11-28T08-42-47-821Z. Do not edit; re-plan instead.
// Scenario: SCN-0001
// Requirements: DEMO-001 (version 1)
// Plan: plan-20261127T171129Z-333e91
// Explorations: exp-20261127T170734Z-c524de, exp-20261127T170955Z-f3b18f

import { test, expect } from '@playwright/test';

test('SCN-0001: Display the login form', async ({ page }) => {
  // Expected (DEMO-001): The page at / shows the heading Sign in to Release Demo, a username field labelled Username, a password field labelled Password, and a button labelled Sign in.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Release Demo', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});
