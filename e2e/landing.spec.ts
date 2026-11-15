import { test, expect } from '@playwright/test';

test.describe('Public Marketing Website / Landing Page (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate directly to public root
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('renders navigation header with brand logo, nav links, and action buttons', async ({
    page,
  }) => {
    // Brand identity
    await expect(page.locator('text=CodeCollab').first()).toBeVisible();

    // Section links
    const nav = page.locator('nav[aria-label="Main Navigation"]');
    await expect(nav.getByRole('link', { name: 'Features' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'How It Works' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Architecture' })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Roadmap/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Pricing' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'FAQ' })).toBeVisible();

    // Guest action buttons
    await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Get Started/i })).toBeVisible();
  });

  test('renders hero headline, subheading, primary CTAs, and Studio window preview', async ({
    page,
  }) => {
    // Exact requested headline
    const headline = page.locator('h1', {
      hasText: 'Code Together. Build Without Limits.',
    });
    await expect(headline).toBeVisible();

    // Subheading
    const subheading = page.locator('p', {
      hasText: /Your complete collaborative cloud development environment/i,
    });
    await expect(subheading).toBeVisible();

    // Action buttons
    await expect(
      page.getByRole('link', { name: /Start Building Free/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Explore the Platform/i }),
    ).toBeVisible();

    // High-Fidelity Studio Window Preview
    await expect(page.locator('text=codecollab-studio · distributed-kv-store')).toBeVisible();
    await expect(page.locator('text=src/server.ts').first()).toBeVisible();
    await expect(page.locator('text=setupCollabMesh').first()).toBeVisible();
    await expect(page.locator('text=Yash (Editing)').first()).toBeVisible();
    await expect(page.locator('text=Docker Terminal').first()).toBeVisible();
  });

  test('displays production technology strip with all 9 core packages', async ({ page }) => {
    const techStripText = [
      'React 18',
      'TypeScript 5',
      'Node.js 20',
      'PostgreSQL 16',
      'Redis 7',
      'Docker Engine',
      'Monaco Editor',
      'Yjs CRDTs',
      'Prisma ORM',
    ];

    for (const tech of techStripText) {
      await expect(page.locator(`text=${tech}`).first()).toBeVisible();
    }
  });

  test('renders all 8 core capabilities in the Feature Showcase', async ({ page }) => {
    const featureHeadings = [
      'Collaborative Cloud IDE',
      'Real-Time Collaboration',
      'Docker Code Execution',
      'Interactive Terminal',
      'Live Web Preview',
      'AI Assistant',
      'Semantic Code Search',
      'Branches & Snapshots',
    ];

    for (const title of featureHeadings) {
      const heading = page.getByRole('heading', { name: title });
      await expect(heading).toBeVisible();
    }
  });

  test('renders the 4-step "How It Works" workflow progression', async ({ page }) => {
    const steps = [
      'Create a Workspace',
      'Invite Collaborators',
      'Code, Execute & Preview',
      'Improve with AI',
    ];

    for (const step of steps) {
      await expect(page.locator(`text=${step}`).first()).toBeVisible();
    }
  });

  test('allows interactive tab switching in Product Showcase', async ({ page }) => {
    // Click "Docker Execution Terminal" tab
    const terminalTab = page.getByRole('button', { name: 'Docker Execution Terminal' });
    await terminalTab.click();
    await expect(page.locator('text=Air-Gapped Container Code Execution')).toBeVisible();

    // Click "AI Subsystem & Search" tab
    const aiTab = page.getByRole('button', { name: 'AI Subsystem & Search' });
    await aiTab.click();
    await expect(page.locator('text=Gemini-Powered Codebase Intelligence')).toBeVisible();

    // Click "Branches & Snapshots" tab
    const snapshotTab = page.getByRole('button', { name: 'Branches & Snapshots' });
    await snapshotTab.click();
    await expect(page.locator('text=Zero-Downtime Rollback Checkpoints')).toBeVisible();
  });

  test('renders defense-in-depth architecture section with roadmap principle link', async ({
    page,
  }) => {
    await expect(page.locator('text=Zero-Trust Sandboxes').first()).toBeVisible();
    await expect(page.locator('text=Dual-Token Silent Rotation').first()).toBeVisible();
    await expect(page.locator('text=Redis Pub/Sub Socket Mesh').first()).toBeVisible();

    const readPrinciplesLink = page.getByRole('link', { name: /Read Architecture Pillars/i });
    await expect(readPrinciplesLink).toBeVisible();
  });

  test('displays transparent pricing presentation with active Developer Preview tier', async ({
    page,
  }) => {
    // Pricing tiers
    await expect(page.getByRole('heading', { name: 'Developer Preview', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();

    // Verified free tier pricing
    await expect(page.locator('text=$0').first()).toBeVisible();
    await expect(page.locator('text=free during preview').first()).toBeVisible();
    await expect(page.locator('text=Current Active Phase').first()).toBeVisible();

    // Verify Pro & Team show "coming soon" and do not render planned tier buttons
    await expect(page.locator('text=coming soon').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Preview Planned Tier/i })).toHaveCount(0);
  });

  test('toggles FAQ accordion questions and reveals detailed answers', async ({ page }) => {
    // FAQ question 1 is open by default
    await expect(
      page.locator('text=CodeCollab is a full-stack, collaborative cloud development platform'),
    ).toBeVisible();

    // Click on Question 3: "How does real-time collaboration prevent merge conflicts?"
    const crdtQuestion = page.getByRole('button', {
      name: /How does real-time collaboration prevent merge conflicts/i,
    });
    await crdtQuestion.click();

    // Verify CRDT answer is revealed
    await expect(
      page.locator('text=CodeCollab uses Yjs, a high-performance Conflict-free Replicated Data Type'),
    ).toBeVisible();
  });

  test('renders final CTA and complete footer link columns', async ({ page }) => {
    // Final headline
    await expect(
      page.getByRole('heading', { name: 'Your next project deserves a better workspace.' }),
    ).toBeVisible();

    // Footer columns
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: 'Roadmap & Voting' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Zero-Trust Sandboxes' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Core Pillars' })).toBeVisible();
  });
});
