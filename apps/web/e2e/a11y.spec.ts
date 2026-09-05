import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const RULE_SETS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const EMAIL = process.env.KORA_SEED_OPERATOR_EMAIL ?? 'operator@acme.test';
const PASSWORD = process.env.KORA_SEED_OPERATOR_PASSWORD ?? 'operator-password';

/** Signs the seeded operator in once; the console routes all require a session. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('#operator-email', EMAIL);
  await page.fill('#operator-password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/ops/, { timeout: 30_000 });
}

async function violationsOn(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(RULE_SETS).analyze();
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')),
  }));
}

test.describe('accessibility', () => {
  test('the landing page and the customer chat report no violations', async ({ page }) => {
    for (const path of ['/', '/chat']) {
      const violations = await violationsOn(page, path);
      expect(violations, `${path}: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
    }
  });

  test('every operator screen reports no violations', async ({ page }) => {
    await signIn(page);
    const paths = [
      '/ops',
      '/ops/conversations',
      '/ops/approvals',
      '/ops/versions',
      '/ops/shadow',
      '/ops/evaluations',
      '/ops/connect',
    ];
    for (const path of paths) {
      const violations = await violationsOn(page, path);
      expect(violations, `${path}: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
    }
  });

  test('the console holds up at a phone width', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/ops', '/ops/conversations']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // Wide content scrolls inside its own container; the page itself must not.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
});
