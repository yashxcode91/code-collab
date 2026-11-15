import { test, expect } from '@playwright/test';

test.describe('Authentication & Navigation (E2E)', () => {
  test('renders login page with OAuth buttons and credential form', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    // Verify Title & Header
    await expect(page.locator('h1', { hasText: 'Welcome back' })).toBeVisible();

    // Verify OAuth buttons (Google & GitHub)
    await expect(page.getByRole('button', { name: /Google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /GitHub/i })).toBeVisible();

    // Verify input fields
    const identifierInput = page.locator('#login-identifier');
    const passwordInput = page.locator('#login-password');
    const submitBtn = page.getByRole('button', { name: /Sign in/i });

    await expect(identifierInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
  });

  test('validates required fields on client-side before submission', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    const submitBtn = page.getByRole('button', { name: /Sign in/i });
    await submitBtn.click();

    // Field-level error messages should appear
    const identifierError = page.locator('text=Email or username is required');
    await expect(identifierError).toBeVisible();
  });

  test('toggles password visibility', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    const passwordInput = page.locator('#login-password');
    const toggleBtn = page.getByRole('button', { name: /Show password/i });

    await passwordInput.fill('secret123');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    const hideBtn = page.getByRole('button', { name: /Hide password/i });
    await hideBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('navigates seamlessly between login and register views', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    // Click "Create an account"
    const registerLink = page.getByRole('link', { name: /Create an account/i });
    await registerLink.click();

    await page.waitForURL('**/register');
    await expect(page.locator('h1', { hasText: /Create your account/i })).toBeVisible();

    // Click "Sign in" to go back to login
    const loginLink = page.getByRole('link', { name: /Sign in/i });
    await loginLink.click();

    await page.waitForURL('**/login');
    await expect(page.locator('h1', { hasText: 'Welcome back' })).toBeVisible();
  });

  test('redirects unauthenticated users accessing protected dashboard to login', async ({ page }) => {
    await page.goto('/dashboard');
    // ProtectedRoute should redirect to /login
    await page.waitForURL('**/login');
    expect(page.url()).toContain('/login');
  });

  test('renders public marketing landing page for unauthenticated visitors at root', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify marketing headline & branding
    const heroHeading = page.locator('h1', {
      hasText: 'Code Together. Build Without Limits.',
    });
    await expect(heroHeading).toBeVisible();

    // Verify Start Building CTA
    const startBtn = page.getByRole('link', { name: /Start Building Free/i }).first();
    await expect(startBtn).toBeVisible();
  });
});
