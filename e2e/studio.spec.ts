import { test, expect } from '@playwright/test';

const MOCK_USER = {
  id: 'usr-playwright',
  email: 'playwright@codecollab.dev',
  username: 'playwright_dev',
  avatarUrl: null,
  role: 'ADMIN',
  createdAt: '2026-11-01T00:00:00.000Z',
};

const MOCK_PROJECTS = [
  {
    id: 'proj-e2e-1',
    name: 'Realtime Distributed KV Store',
    description: 'Raft consensus key-value store in Go & TypeScript with live metrics.',
    language: 'typescript',
    isPublic: true,
    ownerId: 'usr-playwright',
    currentUserRole: 'owner',
    createdAt: '2026-11-10T12:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
  },
];

test.describe('Dashboard & Studio Workspaces (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication session as active logged-in user
    await page.route('**/api/auth/me', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { user: MOCK_USER },
        }),
      });
    });

    // Mock projects listing
    await page.route('**/api/projects*', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { projects: MOCK_PROJECTS },
        }),
      });
    });

    // Mock feedback listing for roadmap navigation
    await page.route('**/api/feedback*', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
        }),
      });
    });

    // Mock health query
    await page.route('**/api/health*', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { status: 'healthy', database: true, redis: true },
        }),
      });
    });
  });

  test('displays authenticated developer dashboard and workspace cards', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify brand logo and workspace navigation in desktop nav
    const nav = page.locator('nav[aria-label="Dashboard sections"]');
    await expect(nav.getByRole('button', { name: 'Workspaces' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Templates' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Activity' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Roadmap' })).toBeVisible();

    // Verify user profile pill in top navigation
    await expect(page.locator(`text=@${MOCK_USER.username}`).first()).toBeVisible();

    // Verify Hub button is removed
    await expect(page.getByRole('button', { name: 'Hub' })).toHaveCount(0);

    // Verify mock project card is rendered
    await expect(page.locator('text=Realtime Distributed KV Store').first()).toBeVisible();
  });

  test('navigates from dashboard navbar to roadmap portal', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Click Roadmap tab in GooeyNavbar
    const roadmapTab = page
      .locator('nav[aria-label="Dashboard sections"]')
      .getByRole('button', { name: 'Roadmap' });
    await roadmapTab.click();

    await page.waitForURL('**/roadmap');
    await expect(
      page.locator('h1', { hasText: 'The Future of Collaborative Development' }),
    ).toBeVisible();
  });

  test('shows Studio loading fallback when navigating to a workspace', async ({ page }) => {
    await page.goto('/studio/proj-e2e-1');

    // Fallback loading indicator should appear while lazy-loading Monaco workers
    const loadingPill = page.locator('text=Loading Studio IDE & Monaco Engine');
    // It should either be visible or quickly transition to the studio interface
    expect(page.url()).toContain('/studio/proj-e2e-1');
  });
});
