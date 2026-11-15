import { test, expect } from '@playwright/test';

test.describe('Roadmap & Architecture Portal (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate directly to the roadmap page
    await page.goto('/roadmap');
    await page.waitForLoadState('domcontentloaded');
  });

  test('renders hero header and page identity correctly', async ({ page }) => {
    // Check page title and identity
    await expect(page).toHaveTitle(/Roadmap & Architecture|CodeCollab/i);

    // Verify Hero heading
    const heroHeading = page.locator('h1', {
      hasText: 'The Future of Collaborative Development',
    });
    await expect(heroHeading).toBeVisible();

    // Verify Hero description
    const heroDescription = page.locator('p', {
      hasText: /Explore what's coming next/i,
    });
    await expect(heroDescription).toBeVisible();
  });

  test('allows filtering roadmap horizons via carousel tabs', async ({ page }) => {
    // Check horizon filter tabs
    const allTab = page.getByRole('button', { name: 'All Horizons' });
    const nowTab = page.getByRole('button', { name: 'Now · Ready' });
    const nextTab = page.getByRole('button', { name: 'Next · Planned' });
    const futureTab = page.getByRole('button', { name: 'Future · Exploring' });

    await expect(allTab).toBeVisible();
    await expect(nowTab).toBeVisible();
    await expect(nextTab).toBeVisible();
    await expect(futureTab).toBeVisible();

    // Click "Now · Ready" tab
    await nowTab.click();
    await expect(nowTab).toHaveClass(/bg-primary/);

    // Click "Future · Exploring" tab
    await futureTab.click();
    await expect(futureTab).toHaveClass(/bg-primary/);

    // Return to "All Horizons"
    await allTab.click();
    await expect(allTab).toHaveClass(/bg-primary/);
  });

  test('displays technology stack grid and engineering principles', async ({ page }) => {
    // Verify Section B: Technology Stack
    const techStackHeading = page.getByRole('heading', {
      name: /Production Stack & Libraries/i,
    });
    await expect(techStackHeading).toBeVisible();

    // Check core tech badges
    await expect(page.locator('text=Monaco Editor').first()).toBeVisible();
    await expect(page.locator('text=TypeScript').first()).toBeVisible();
    await expect(page.locator('text=PostgreSQL').first()).toBeVisible();

    // Verify Section C: Engineering Principles
    const principlesHeading = page.getByRole('heading', {
      name: /Core Architectural Pillars/i,
    });
    await expect(principlesHeading).toBeVisible();
    await expect(page.locator('text=Security-First Architecture').first()).toBeVisible();
    await expect(page.locator('text=Isolated Code Execution').first()).toBeVisible();
  });

  test('supports interactive community feature upvoting and downvoting', async ({ page }) => {
    let currentVoteDirection: 'up' | 'down' | null = null;
    let currentVotes = 12;

    await page.route(/\/api\/feedback/, async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: 'f-1',
                title: 'High-Performance WebContainers Integration',
                description: 'Run Node.js runtime environments directly in the browser tab.',
                category: 'Infrastructure',
                authorName: 'Core Architecture',
                votes: currentVotes,
                userVoted: currentVoteDirection !== null,
                userVoteDirection: currentVoteDirection,
                createdAt: '2026-11-10T12:00:00.000Z',
              },
            ],
          }),
        });
      }

      if (request.method() === 'POST' && request.url().includes('/vote')) {
        const body = request.postDataJSON() || {};
        const direction = body.direction || 'up';

        if (currentVoteDirection === direction) {
          currentVotes += direction === 'up' ? -1 : 1;
          currentVoteDirection = null;
        } else {
          currentVotes +=
            direction === 'up'
              ? currentVoteDirection === 'down'
                ? 2
                : 1
              : currentVoteDirection === 'up'
                ? -2
                : -1;
          currentVoteDirection = direction;
        }

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'f-1',
              votes: currentVotes,
              userVoted: currentVoteDirection !== null,
              userVoteDirection: currentVoteDirection,
            },
          }),
        });
      }

      return route.continue();
    });

    // Reload with active route mocking
    await page.goto('/roadmap');
    await page.waitForLoadState('domcontentloaded');

    // Scroll to the community feature proposals section
    const votingHeading = page.getByRole('heading', {
      name: /Community Feature Voting & Proposals/i,
    });
    await votingHeading.scrollIntoViewIfNeeded();
    await expect(votingHeading).toBeVisible();

    // Find the first curated feature card
    const firstCard = page.locator('.glass-mirror:has(button[aria-label*="Upvote"])').first();
    await expect(firstCard).toBeVisible();

    // Locate the Upvote and Downvote buttons inside this card
    const upvoteBtn = firstCard.locator('button[aria-label*="Upvote"]');
    const downvoteBtn = firstCard.locator('button[aria-label*="Downvote"]');

    await expect(upvoteBtn).toBeVisible();
    await expect(downvoteBtn).toBeVisible();

    // Upvote the feature
    await upvoteBtn.click();

    // Verify Upvote is active (emerald green background)
    await expect(upvoteBtn).toHaveClass(/bg-emerald-600/);

    // Switch to Downvote directly
    await downvoteBtn.click();

    // Verify Downvote is active (rose red background) and Upvote is inactive
    await expect(downvoteBtn).toHaveClass(/bg-rose-600/);
    await expect(upvoteBtn).not.toHaveClass(/bg-emerald-600/);

    // Toggle off Downvote
    await downvoteBtn.click();
    await expect(downvoteBtn).not.toHaveClass(/bg-rose-600/);
  });

  test('submits a new feature suggestion to the engineering backlog', async ({ page }) => {
    // Locate the proposal form
    const proposalHeading = page.getByRole('heading', {
      name: /Propose a Feature or Improvement/i,
    });
    await proposalHeading.scrollIntoViewIfNeeded();
    await expect(proposalHeading).toBeVisible();

    // Fill in the form fields
    const titleInput = page.locator('#suggest-title');
    const descTextarea = page.locator('#suggest-desc');
    const categorySelect = page.locator('#suggest-category');
    const submitBtn = page.getByRole('button', { name: /Submit Proposal/i });

    await titleInput.fill('Automated Flaky Test Quarantine Service');
    await categorySelect.selectOption('Infrastructure');
    await descTextarea.fill(
      'Automatically isolate flaky integration tests and trigger diagnostic reruns with structured telemetry.',
    );

    // Submit form
    await submitBtn.click();

    // Verify success feedback confirmation
    const successMsg = page.locator(
      'text=Proposal submitted to the engineering team!',
    );
    await expect(successMsg).toBeVisible({ timeout: 6000 });
  });

  test('navigates back to studio from footer CTA', async ({ page }) => {
    // Scroll to the footer callout
    const backToStudioBtn = page.getByRole('link', { name: /Back to Studio/i });
    await backToStudioBtn.scrollIntoViewIfNeeded();
    await expect(backToStudioBtn).toBeVisible();

    // Click back to studio
    await backToStudioBtn.click();
    await page.waitForURL('**/');
    expect(page.url()).toMatch(/\/$/);
  });
});
