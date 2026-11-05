/**
 * SauceDemo Smoke Test
 *
 * Verifies that the login page loads and displays the expected login controls.
 * Uses accessible locators and meaningful assertions.
 */

import { test, expect } from '@playwright/test';

test.describe('SauceDemo Login Page', () => {
  test('displays expected login controls', async ({ page }) => {
    // Navigate to the login page (baseURL comes from project config)
    await page.goto('/');

    // Verify the page title
    await expect(page).toHaveTitle('Swag Labs');

    // Verify the login form heading is visible
    const loginLogo = page.locator('.login_logo');
    await expect(loginLogo).toBeVisible();
    await expect(loginLogo).toHaveText('Swag Labs');

    // Verify username input is present and accessible
    const usernameInput = page.getByPlaceholder('Username');
    await expect(usernameInput).toBeVisible();
    await expect(usernameInput).toBeEnabled();

    // Verify password input is present and accessible
    const passwordInput = page.getByPlaceholder('Password');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toBeEnabled();

    // Verify the login button is present and accessible
    const loginButton = page.getByRole('button', { name: 'Login' });
    await expect(loginButton).toBeVisible();
    await expect(loginButton).toBeEnabled();

    // Verify the credentials information section exists
    // This demonstrates the page loaded completely with all expected content
    const loginCredentials = page.locator('#login_credentials');
    await expect(loginCredentials).toBeVisible();
    await expect(loginCredentials).toContainText('Accepted usernames');
  });
});
