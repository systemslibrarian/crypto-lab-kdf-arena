import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Three rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The gate this file
 *     replaces opened with `page.addStyleTag` forcing
 *     `transition:none;animation:none` onto every element. That does not
 *     emulate a reduced-motion visitor — it BYPASSES the lab's own
 *     `prefers-reduced-motion` blocks, so the suite was structurally unable to
 *     see the defect where an element's only route to its visible state is an
 *     animation those blocks cancel. This lab has four such blocks and three
 *     animated exhibits (`.mem-cell-filled`, `.sch-block`, `.bar-fill`), which
 *     is precisely where that defect would live. It also force-opened both
 *     `<details>` from script rather than clicking their summaries.
 *
 *  2. EVERY SCAN ASSERTS ITS CONTENT IS PRESENT FIRST, and there are scans well
 *     past first paint. axe over an empty container passes having checked
 *     nothing — and `#results` ships as a one-line placeholder.
 *
 *  3. `violations` IS NOT THE WHOLE ORACLE. See `scan`.
 *
 * What this gate CANNOT see: the memory grids, the attacker-rig lanes, the
 * timing bars and every control boundary are not text-owning elements, and
 * `.bar-value` is `aria-hidden`. Those are hand-measured from screenshot pixels
 * and their fixes live in `src/style.css`. This file covers the rest.
 */

/**
 * Soft-gate collection mode.
 *
 * A gate that throws on the first finding tells you about one defect per run,
 * and a run of this suite is four full drives. With `A11Y_COLLECT=1` every
 * assertion in `scan` records its failure and continues, so one pass enumerates
 * everything wrong in all four configurations.
 *
 * The dangerous version of this idea is a check that merely logs. This one
 * cannot be mistaken for a passing gate: `reportCollected()` runs at the end of
 * every test and FAILS if a collecting run recorded anything at all. So the
 * only way a collecting run goes green is if there was nothing to collect, and
 * the only way to get a green gate is with the env var unset, where every
 * assertion is strict and throws where it stands.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

async function soft(fn: () => void | Promise<void>): Promise<void> {
  if (!COLLECTING) {
    await fn();
    return;
  }
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    collected.push(message);
    console.log(`\n=== COLLECTED #${collected.length} ===\n${message}\n`);
  }
}

/**
 * Fail the test if a collecting run recorded anything. Call at the end of every
 * test — this is what stops a collection pass from ever reading as a pass.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(
    collected.length,
    `A11Y_COLLECT run recorded ${collected.length} findings (printed above). ` +
      'This mode never passes with findings; fix them and re-run without the env var.'
  ).toBe(0);
}

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead. This lab needs it: `.bar-fill`
 * transitions its width over 600ms, the memory-grid cells run a staggered
 * 400ms fill and the schematic blocks a 500ms cascade, so a scan fired straight
 * after a benchmark would read half-drawn figures. Under reduced motion the
 * lab's own media queries cancel all three — which is the point: this waits on
 * whatever the page actually decided to run, rather than deciding for it.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab is
 * one edit away from it: `.sch-block` animates `sch-block-in`, whose 0% keyframe
 * is `opacity: 0`, with `animation-fill-mode: both` — and the reduced-motion
 * block cancels the animation with `animation: none`. It is safe TODAY only
 * because `.sch-block` also declares `background-color: var(--accent)` outside
 * the keyframes, so the natural state is the visible one. Move that declaration
 * into the keyframes and every reduced-motion reader gets an empty box. This
 * assertion is what would catch that.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  // `index.html`'s anti-flash script stamps `data-theme` for both themes, so
  // the attribute is asserted directly either way. Worth checking rather than
  // assuming: the shared header's toggle and the lab's own both write the
  // `theme` key, and the anti-flash script reads the same one — a mismatch
  // there is silent, and the theme simply never persists.
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  // ASSERT THE LAB'S DEFAULTS rather than assuming them. Which half of this
  // lab a single-configuration gate scans depends entirely on these: both
  // disclosures ship CLOSED, the salt-reuse teaching toggle ships OFF (so the
  // dangerous branch it exists to demonstrate is the one nobody scanned), both
  // "Weaken" presets ship un-pressed at their strong defaults, and `#results`
  // is a one-line placeholder until a benchmark has run.
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('#password-input')).toHaveValue('correct horse battery staple');
  await expect(page.locator('#reuse-salt')).not.toBeChecked();
  await expect(page.locator('#glossary')).not.toHaveAttribute('open', /.*/);
  await expect(page.locator('#params-advanced')).not.toHaveAttribute('open', /.*/);
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.results-placeholder')).toBeVisible();
  await expect(page.locator('.result-cards')).toHaveCount(0);
  await expect(page.locator('#run-btn')).toBeEnabled();
  for (const btn of await page.locator('.preset-btn').all()) {
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  }
  // The cost defaults are the strong ones, and the drive below relies on that
  // to tell "weakened" apart from "shipped".
  await expect(page.locator('#pbkdf2-iterations')).toHaveValue('600000');
  await expect(page.locator('#argon2-memory')).toHaveValue('65536');

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is a
 * plausible offender: the result cards are an `auto-fit` grid with a
 * `minmax(200px, 1fr)` floor, the attacker rig is a 24-column grid, each
 * memory grid is 12 columns of fixed-aspect cells, and the cards print raw
 * derived-key hex.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    // `body { overflow-x: hidden }` propagates to the viewport when `html`
    // leaves `overflow` at `visible`, so `scrollWidth` stays equal to
    // `clientWidth` even when content is CUT OFF — a worse 1.4.10 outcome than
    // a scrollbar, and invisible to the standard check. This lab does not have
    // that rule today; the check detects the clipping directly anyway, so
    // adding one later cannot turn this oracle permanently green.
    const clippedByViewport = ['hidden', 'clip'].includes(
      getComputedStyle(document.body).overflowX,
    );
    if (!clippedByViewport && doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide block inside an `overflow: hidden` wrapper has a huge bounding rect
    // but is clipped by that wrapper and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      // Stop BEFORE <body>. When `body { overflow-x: hidden }` propagates to the
      // viewport, body itself answers "hidden" to this walk — so every element
      // on the page reads as clipped, `escaping` is always empty, and the oracle
      // reports nothing at all. That is the failure this whole check exists to
      // avoid: a viewport-level clip is the DEFECT, not a legitimate scroller.
      // Only a genuine scrolling container INSIDE the page excuses an overflow.
      while (n && n !== doc && n !== document.body) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const escaping = over.filter((x) => !clipped(x.el));
    if (!escaping.length) return null;
    const widest = escaping[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll. This lab has no scrolling container
 * today — its three `overflow: hidden` rules clip rather than scroll — so this
 * is a guard against one appearing, which is exactly when it would be missed.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Six assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - `expectNotBlank` — nothing visible may render at effective opacity 0. This
 *    is the reduced-motion end-state check.
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. Everything else in that bucket is a real result
 *    axe simply could not finish — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less div hides, a defect that never
 *    reaches the violations array at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node,
 *    gradients and opacity groups included.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no text
 * node. Both were being found by hand-sampling screenshot pixels, which does
 * not regress-test.
 *
 * The backlog is real, so this does not block on it — but a check that merely
 * logs is not a gate, and this sweep has spent its whole length deleting checks
 * that could not fail. So it ratchets instead: anything NOT in the baseline
 * fails, anything in the baseline that got WORSE fails, and anything in the
 * baseline that has been FIXED fails until its entry is deleted. That last rule
 * is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it. Opt-in via env, and the run is
  // deliberately left failing at the end by `expectBaselineNotStale` so a
  // capture pass can never be mistaken for a passing gate.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(
        `WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`
      );
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await soft(() => expectNotBlank(page, label));
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  await soft(() => expect(violations, `axe violations in state: ${label}`).toEqual([]));

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  await soft(() =>
    expect(unexplainedIncomplete, `axe incomplete results in state: ${label}`).toEqual([])
  );

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  await soft(() => expect(contrast, `measured contrast failures in state: ${label}`).toEqual([]));

  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
  await expectNoNewNonTextFailures(page, label);
}

/**
 * Run the benchmark with the form as it currently stands, and wait for the real
 * completion signal rather than a duration.
 *
 * `#results` is `aria-live="polite"` with an `aria-busy` flag the submit handler
 * flips, so the flag IS the signal. Argon2id at the shipped 64 MiB takes real
 * seconds, so this needs a longer leash than the default.
 */
async function runBenchmark(page: Page): Promise<void> {
  // The click itself needs a long timeout, not just the wait after it.
  // `argon2idAsync` is pure JS: it yields between passes, but at the shipped
  // 64 MiB each pass is a multi-second task, and Playwright's post-click
  // round-trip queues behind them. With the suite's 20s default this timed out
  // INSIDE `click()` — before any assertion — which reads like a broken
  // selector and is nothing of the sort.
  await page.locator('#run-btn').click({ timeout: 180_000 });
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false', {
    timeout: 180_000,
  });
  await expect(page.locator('.result-cards')).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(4);
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * This lab is one form and one results region, and almost everything
 * interesting is off the default path: both disclosures are closed, the
 * salt-reuse toggle that demonstrates the rainbow-table failure is off, and
 * both "Weaken" presets are un-pressed. The old gate ran the benchmark once at
 * the defaults and scanned twice, so the warning callout, the pressed preset
 * styling, the log scale and every extreme of the cost inputs went unmeasured.
 *
 * Two branches earn their place specifically:
 *
 *  - the salt-reuse callout swaps the accent palette for the warn palette
 *    across a whole panel — a second colour scheme reachable by one checkbox.
 *  - the attacker rig's slider has a compute-bound branch and a RAM-bound
 *    branch, and only the extremes of its range cross between them. Its
 *    `role="status"` text changes with it, so the extremes are driven, not the
 *    shipped middle.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  await scan(page, `${theme} / first paint (placeholder)`);

  // --- Skip links: parked off-screen until focused. The focused rendering is a
  // real state and the contrast walk deliberately skips the parked one.
  await page.keyboard.press('Tab');
  await expect(page.locator('.cl-skip-link')).toBeFocused();
  await scan(page, `${theme} / shared skip link focused`);

  // --- Both disclosures, opened by clicking their summaries. Forcing `open`
  // from script skips the toggle the visitor actually performs.
  const glossary = page.locator('#glossary');
  await glossary.locator('summary').click();
  await expect(glossary).toHaveAttribute('open', /.*/);
  await expect(glossary.locator('dd').first()).toBeVisible();
  await scan(page, `${theme} / glossary open`);
  await glossary.locator('summary').click();
  await expect(glossary).not.toHaveAttribute('open', /.*/);
  await scan(page, `${theme} / glossary closed again`);

  const params = page.locator('#params-advanced');
  await params.locator('summary').click();
  await expect(params).toHaveAttribute('open', /.*/);
  await expect(page.locator('.param-set')).toHaveCount(3);
  await scan(page, `${theme} / cost parameters open`);

  // --- The "Weaken" presets. `aria-pressed` flips, the label is REPLACED, and
  // `.is-weak` swaps the whole button from the warn palette to the accent one —
  // a state change that repaints a control's fill, border and ink at once.
  const presets = page.locator('.preset-btn');
  const presetCount = await presets.count();
  expect(presetCount, 'the cost panel must offer weaken presets').toBeGreaterThan(0);
  for (let i = 0; i < presetCount; i++) {
    await presets.nth(i).click();
    await expect(presets.nth(i)).toHaveAttribute('aria-pressed', 'true');
    await expect(presets.nth(i)).toHaveText('Restore strong default');
    await scan(page, `${theme} / preset ${i + 1} weakened`);
  }

  // Restore, so the benchmark below runs the shipped cost and the "weakened"
  // ratios later are a real comparison rather than a second weak run.
  for (let i = 0; i < presetCount; i++) {
    await presets.nth(i).click();
    await expect(presets.nth(i)).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(page.locator('#pbkdf2-iterations')).toHaveValue('600000');
  await scan(page, `${theme} / presets restored`);

  // --- The invalid-cost branch. `#argon2-memory` advertises `min="8"`, which
  // is only reachable at p=1: RFC 9106 requires m >= 8*p, and the field ships
  // at p=4. So the form's own minimum is a value the run cannot accept, and
  // that error state is a real thing a visitor reaches by dragging the number
  // down. It renders a `role="alert"` and is scanned like any other state.
  await page.locator('#argon2-memory').fill('8');
  await page.locator('#run-btn').click();
  await expect(page.locator('.status-error')).toBeVisible();
  await expect(page.locator('.status-error')).toContainText('at least 32 KiB');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await scan(page, `${theme} / argon2 memory below 8*p (error branch)`);

  // --- Drive the extremes of the cost inputs, not just the defaults. This is
  // the fastest, smallest-memory run the page can actually produce, and the one
  // where every bar collapses toward zero width.
  await page.locator('#argon2-parallelism').fill('1');
  await page.locator('#argon2-memory').fill('8');
  await page.locator('#argon2-time').fill('1');
  await page.locator('#scrypt-n').fill('2');
  await page.locator('#pbkdf2-iterations').fill('1');
  await runBenchmark(page);
  await scan(page, `${theme} / benchmark at minimum cost`);

  // Back to the shipped costs for the real run.
  await page.locator('#argon2-parallelism').fill('4');
  await page.locator('#argon2-time').fill('3');
  await page.locator('#argon2-memory').fill('65536');
  await page.locator('#scrypt-n').fill('131072');
  await page.locator('#pbkdf2-iterations').fill('600000');
  await runBenchmark(page);
  await expect(page.locator('.mem-grid')).toHaveCount(4);
  await expect(page.locator('#rig-lanes .rig-token').first()).toBeAttached();
  await scan(page, `${theme} / benchmark at shipped cost`);

  // --- The memory chart's log scale: a second rendering of the same bars, with
  // its caption rewritten and the pressed button moved.
  const scaleBtns = page.locator('.scale-btn');
  await scaleBtns.nth(1).click();
  await expect(scaleBtns.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(scaleBtns.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await scan(page, `${theme} / memory chart on log scale`);
  await scaleBtns.nth(0).click();
  await expect(scaleBtns.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await scan(page, `${theme} / memory chart back on linear scale`);

  // --- The attacker rig at both ends of its range. The compute-bound and
  // RAM-bound branches render different lane fills and different status text,
  // and neither is the shipped middle.
  const slider = page.locator('#rig-argon-mem');
  await slider.fill('8');
  await slider.dispatchEvent('input');
  await expect(page.locator('#rig-status')).not.toBeEmpty();
  await scan(page, `${theme} / attacker rig at minimum memory`);
  await slider.fill('1048576');
  await slider.dispatchEvent('input');
  await expect(page.locator('#rig-status')).not.toBeEmpty();
  await scan(page, `${theme} / attacker rig at maximum memory`);

  // --- Salt reuse: one checkbox repaints the callout from the accent palette
  // to the warn palette. This is the branch the exhibit exists for, and it is
  // off by default, so nothing scanned it before.
  await page.locator('#reuse-salt').check();
  await expect(page.locator('#reuse-salt')).toBeChecked();
  await scan(page, `${theme} / salt reuse checked, before re-running`);
  await runBenchmark(page);
  await expect(page.locator('.salt-callout-warn')).toBeVisible();
  await scan(page, `${theme} / salt reuse callout (warn palette)`);

  await page.locator('#reuse-salt').uncheck();
  await runBenchmark(page);
  await expect(page.locator('.salt-callout-warn')).toHaveCount(0);
  await expect(page.locator('.salt-callout')).toBeVisible();
  await scan(page, `${theme} / fresh salt callout (accent palette)`);

  // --- The empty-password branch: the handler refuses and focuses the field
  // rather than running, leaving the previous results on screen.
  await page.locator('#password-input').fill('');
  await page.locator('#run-btn').click();
  await expect(page.locator('#password-input')).toBeFocused();
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await scan(page, `${theme} / empty password refused`);
  await page.locator('#password-input').fill('correct horse battery staple');
}
