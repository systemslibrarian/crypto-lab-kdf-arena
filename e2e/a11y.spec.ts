import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG regression gate. Deploys are gated on accessibility the same way they
 * are on correctness: axe-core scans the full page — placeholder state and the
 * rendered benchmark results — in both themes, with every collapsible expanded.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function killMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}`,
  });
}

async function openAllDetails(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) {
      details.open = true;
    }
  });
}

async function runBenchmark(page: Page): Promise<void> {
  // Drive the demo so the results region (cards + timing bars) is populated
  // and gets scanned, not just the empty placeholder.
  await page.locator('#run-btn').click();
  await expect(page.locator('.result-cards')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await page.goto('.');
  await killMotion(page);
  await openAllDetails(page);
  await scan(page);
  await runBenchmark(page);
  await openAllDetails(page);
  await scan(page);
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await page.goto('.');
  await killMotion(page);
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openAllDetails(page);
  await scan(page);
  await runBenchmark(page);
  await openAllDetails(page);
  await scan(page);
});
