// Automated accessibility + mobile audit harness.
//
// Builds nothing itself — run `npm run build` first. Then it:
//   1. serves dist/ on a local port (vite preview),
//   2. drives the page with Playwright/Chromium on desktop + mobile viewports,
//   3. runs axe-core (WCAG 2.0/2.1 A + AA) in both the initial and post-run
//      states,
//   4. runs Lighthouse (mobile form factor) for accessibility, best-practices,
//      SEO and performance,
//   5. saves screenshots as visual proof,
//   6. exits non-zero if any axe violation is found or Lighthouse a11y < 1.0.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'screenshots');
const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
];

const summary = { axe: [], sr: [], lighthouse: null };

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('preview server did not start'));
      setTimeout(poll, 300);
    })();
  });
}

async function runBenchmark(page) {
  await page.click('#run-btn');
  // Results replace the placeholder with the cards list once the run finishes.
  await page.waitForSelector('.result-cards', { timeout: 60000 });
  // Wait for the button to settle back to its enabled steady state so contrast
  // is sampled at rest, not mid-transition.
  await page.waitForSelector('#run-btn:not([disabled])', { timeout: 5000 });
}

async function axeScan(page, label) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const v = results.violations;
  summary.axe.push({ label, count: v.length, violations: v });
  const tag = v.length === 0 ? 'PASS' : `FAIL (${v.length})`;
  console.log(`  axe [${label}]: ${tag}`);
  for (const item of v) {
    console.log(`    - ${item.id} (${item.impact}): ${item.help} [${item.nodes.length} node(s)]`);
    for (const node of item.nodes.slice(0, 3)) {
      console.log(`        ${node.target.join(' ')}`);
    }
  }
}

// Verifies the accessible name/role tree a screen reader actually exposes —
// rule scanners (axe/Lighthouse) check compliance, not the lived SR structure.
async function screenReaderChecks(page) {
  const checks = [];
  const want = async (desc, locator, count) => {
    const n = await locator.count();
    const ok = count === undefined ? n > 0 : n === count;
    checks.push({ desc, ok, got: n, want: count ?? '>=1' });
  };

  await want('h1 "KDF Arena"', page.getByRole('heading', { level: 1, name: 'KDF Arena' }), 1);
  await want('h2 "Results"', page.getByRole('heading', { level: 2, name: 'Results' }), 1);
  await want('h2 "Timing comparison"', page.getByRole('heading', { level: 2, name: 'Timing comparison' }), 1);
  await want('4 KDF h3 headings', page.getByRole('heading', { level: 3 }), 4);
  await want('Run button has accessible name', page.getByRole('button', { name: 'Run Benchmark' }), 1);
  // The shared crypto-lab topbar hides the lab's own toggle and provides its
  // own ("Toggle color theme"), so that is the one exposed to screen readers.
  await want('Theme toggle has accessible name', page.getByRole('button', { name: 'Toggle color theme' }), 1);
  await want('Password textbox is labelled', page.getByRole('textbox', { name: 'Password' }), 1);
  await want('Skip link is reachable', page.getByRole('link', { name: 'Skip to results' }), 1);
  await want('Results is a named region', page.getByRole('region', { name: 'Benchmark results' }), 1);
  await want('4 timing meters exposed', page.getByRole('meter'), 4);
  await want('Argon2id meter is named', page.getByRole('meter', { name: 'Argon2id' }), 1);

  const failed = checks.filter((c) => !c.ok);
  summary.sr.push({ checks, failed: failed.length });
  console.log(`  screen-reader tree: ${failed.length === 0 ? 'PASS' : `FAIL (${failed.length})`}`);
  for (const c of checks) {
    console.log(`    ${c.ok ? '✓' : '✗'} ${c.desc}${c.ok ? '' : ` (got ${c.got}, want ${c.want})`}`);
  }
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  console.log('Starting preview server…');
  // Spawn the vite binary via node directly — avoids the npm.cmd/shell path
  // (and its spawn deprecation) and works cross-platform.
  const viteBin = join(HERE, '..', 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: join(HERE, '..'), stdio: 'ignore' },
  );
  await waitForServer(URL);
  console.log(`Preview up at ${URL}\n`);

  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      console.log(`▶ ${vp.name} (${vp.viewport.width}×${vp.viewport.height})`);
      const context = await browser.newContext({
        viewport: vp.viewport,
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch,
        deviceScaleFactor: vp.deviceScaleFactor,
        userAgent: vp.userAgent,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await page.goto(URL, { waitUntil: 'networkidle' });

      await axeScan(page, `${vp.name}:initial`);
      await page.screenshot({ path: join(SHOTS, `${vp.name}-initial.png`), fullPage: true });

      await runBenchmark(page);
      await axeScan(page, `${vp.name}:results`);
      if (vp.name === 'desktop') await screenReaderChecks(page);
      await page.screenshot({ path: join(SHOTS, `${vp.name}-results.png`), fullPage: true });

      await context.close();
    }

    // ── Lighthouse (default = mobile form factor) ──
    console.log('\n▶ Lighthouse (mobile form factor)');
    const chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: ['--headless=new', '--no-sandbox'],
    });
    try {
      const lh = await lighthouse(
        URL,
        { port: chrome.port, output: 'json', logLevel: 'error' },
        {
          extends: 'lighthouse:default',
          settings: { onlyCategories: ['accessibility', 'best-practices', 'seo', 'performance'] },
        },
      );
      const cats = lh.lhr.categories;
      summary.lighthouse = Object.fromEntries(
        Object.entries(cats).map(([k, c]) => [k, c.score]),
      );
      for (const [k, c] of Object.entries(cats)) {
        console.log(`  ${k}: ${Math.round((c.score ?? 0) * 100)}`);
      }
      await writeFile(join(HERE, 'lighthouse.json'), JSON.stringify(lh.lhr, null, 2));
    } finally {
      // chrome-launcher's temp-dir cleanup can race the still-exiting Chrome
      // process on Windows (EPERM). Scores are already captured by here, so a
      // teardown failure must not mask a passing audit.
      try {
        await chrome.kill();
      } catch (err) {
        console.warn(`  (ignored Chrome teardown error: ${err.code ?? err.message})`);
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }

  // ── Verdict ──
  const totalViolations = summary.axe.reduce((n, s) => n + s.count, 0);
  const srFailures = summary.sr.reduce((n, s) => n + s.failed, 0);
  const a11yScore = summary.lighthouse?.accessibility ?? 0;
  console.log('\n──────── VERDICT ────────');
  console.log(`axe violations (all states/viewports): ${totalViolations}`);
  console.log(`screen-reader tree failures: ${srFailures}`);
  console.log(`Lighthouse accessibility: ${Math.round(a11yScore * 100)}`);
  await writeFile(join(HERE, 'summary.json'), JSON.stringify(summary, null, 2));

  const pass = totalViolations === 0 && srFailures === 0 && a11yScore >= 1.0;
  console.log(pass ? '✅ GOLD STANDARD' : '❌ Issues remain');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
