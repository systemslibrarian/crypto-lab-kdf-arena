import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('record comparison executes all three designs and clears stale results when the selection changes', async ({ page }) => {
  await page.goto('./#record-design');
  const exercise = page.locator('#record-design');
  await expect(exercise.getByRole('textbox')).toHaveCount(0);
  await expect(exercise.locator('option')).toHaveCount(6);
  await page.locator('#password-input').fill('unrelated-benchmark-input');
  await page.locator('#record-run').click();
  await expect(page.locator('.record-complete')).toBeVisible();
  await expect(page.locator('#record-results')).toHaveAttribute('aria-busy', 'false');
  const values = await page.locator('.record-table tbody tr').evaluateAll((rows) => rows.map((row) =>
    Array.from(row.querySelectorAll('[data-count]')).map((cell) => Number(cell.textContent))));
  expect(values).toEqual([
    [1, 0, 3, 0, 3, 0],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 0, 3, 3, 0],
  ]);
  await expect(page.locator('.record-recovered')).toHaveText(Array(3).fill('demo-coral-owl'));
  await expect(exercise).not.toContainText('unrelated-benchmark-input');
  await page.locator('[data-trace="cheap-hash-tail"] summary').click();
  await expect(page.locator('[data-trace="cheap-hash-tail"] li')).toHaveCount(3);
  await expect(page.locator('[data-trace="cheap-hash-tail"]')).toContainText('No scrypt verification');
  await page.locator('#record-password').selectOption('5');
  await expect(page.locator('.record-table')).toHaveCount(0);
  await expect(page.locator('#record-results')).toContainText('Selection changed');
  await page.locator('#record-run').click();
  await expect(page.locator('[data-record="kdf-only"] [data-count="recover-f"]')).toHaveText('6');
  await expect(page.locator('[data-record="cheap-hash-tail"] [data-count="recover-h"]')).toHaveText('6');
  await expect(page.locator('.record-recovered')).toHaveText(Array(3).fill('demo-violet-wren'));
});

for (const theme of ['dark', 'light'] as const) {
  test(`record workshop is usable on a narrow ${theme} page with open recovery traces`, async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 850 });
    await page.goto('./#record-design');
    await page.evaluate((selected) => document.documentElement.setAttribute('data-theme', selected), theme);
    await page.locator('#record-run').click();
    await expect(page.locator('.record-complete')).toBeVisible();
    for (const summary of await page.locator('.record-trace summary').all()) await summary.click();
    await expect(page.locator('.record-trace[open]')).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await expect(page.locator('.record-table-scroll')).toHaveAttribute('tabindex', '0');
    const audit = await new AxeBuilder({ page }).include('#record-design')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
  });
}
