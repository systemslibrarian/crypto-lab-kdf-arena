import { expect, test, type Page } from '@playwright/test';

/**
 * Functional gate: the claims the page makes, asserted against the page it
 * actually renders in a browser.
 *
 * The a11y suite proves the page is reachable; this suite proves it is HONEST.
 * Every assertion here is either
 *   (a) internally consistent — a figure recomputed from the other figures the
 *       same run put on screen (bar widths from times, attacker rate from the
 *       card's own time and memory, lane counts summing to the rig's cores), or
 *   (b) a failure/tamper path driven to its failure state, checked to also say
 *       WHY it failed.
 * Nothing here compares against a magic constant that the page could drift away
 * from silently, and no timing threshold is absolute — only orderings and
 * ratios, so the suite is not machine-dependent.
 */

// The attacker model as bench.ts defines it. Kept here so the spec recomputes
// the published figures from the page's own displayed inputs rather than
// trusting the page to agree with itself.
const RIG_LANES = 8192;
const RIG_RAM_KB = 8 * 1024 * 1024;

interface Card {
  kdf: string;
  timeMs: number;
  params: Record<string, number | string>;
  memoryKB: number;
  rate: number;
  bound: string;
  keyHex: string;
}

function num(text: string): number {
  return Number(text.replace(/[^0-9.]/g, ''));
}

/** Parse "~6.8 million" / "~152" back into a number. */
function parseRate(text: string): number {
  const t = text.replace(/[~\s]+/g, ' ').trim();
  const n = Number(t.replace(/[^0-9.]/g, ''));
  if (/trillion/.test(t)) return n * 1e12;
  if (/billion/.test(t)) return n * 1e9;
  if (/million/.test(t)) return n * 1e6;
  if (/thousand/.test(t)) return n * 1e3;
  return n;
}

async function readCards(page: Page): Promise<Card[]> {
  const rows = await page.$$eval('.result-card', (els) =>
    els.map((e) => {
      const text = (sel: string): string => e.querySelector(sel)?.textContent ?? '';
      const params: Record<string, number | string> = {};
      for (const pair of text('.params').split(',')) {
        const [k, v] = pair.split(':').map((s) => s.trim());
        if (!k || v === undefined) continue;
        params[k] = v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
      }
      return {
        kdf: text('h3').trim(),
        timeMs: Number(text('.time').replace(/[^0-9.]/g, '')),
        params,
        memoryKB: Number((text('.memory').match(/~([\d,]+) KB/)?.[1] ?? '').replace(/,/g, '')),
        rateText: text('.attacker-rate').trim(),
        bound: text('.attacker-bound').trim(),
        keyHex: text('.output-preview code').replace(/[^0-9a-f]/g, ''),
      };
    }),
  );
  return rows.map(({ rateText, ...rest }) => ({ ...rest, rate: parseRate(rateText) }));
}

async function openParams(page: Page): Promise<void> {
  await page.evaluate(() => {
    const d = document.getElementById('params-advanced') as HTMLDetailsElement | null;
    if (d) d.open = true;
  });
}

/** Cheap-but-still-real cost parameters, for the tests that are not about the
 *  shipped defaults. Every relation asserted holds at any parameters. */
async function setFastParams(page: Page, over: Record<string, string> = {}): Promise<void> {
  await openParams(page);
  const values: Record<string, string> = {
    '#pbkdf2-iterations': '1000',
    '#scrypt-n': '2048',
    '#scrypt-r': '8',
    '#scrypt-p': '1',
    '#argon2-time': '1',
    '#argon2-memory': '1024',
    '#argon2-parallelism': '1',
    ...over,
  };
  for (const [sel, value] of Object.entries(values)) await page.fill(sel, value);
}

async function runBench(page: Page, timeout = 180_000): Promise<void> {
  await page.locator('#run-btn').click();
  await expect(page.locator('.result-cards')).toBeVisible({ timeout });
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false', { timeout });
}

test.describe('the arena benchmarks what it says it benchmarks', () => {
  test.slow();

  test('a default run reports four KDFs whose figures agree with their own parameters', async ({
    page,
  }) => {
    await page.goto('.');

    // Running state: the page claims an aria-busy live region and a disabled
    // button while the work is in flight. The derivations chain microtasks, so
    // the page never yields to the driver mid-run — every out-of-page probe
    // (click(), evaluate(), expect polling) only resolves once the run is over.
    // Sampling from inside the page, right after the click dispatch, is the one
    // way to observe the busy state at all.
    const trace = await page.evaluate(async () => {
      const results = document.getElementById('results')!;
      const btn = document.getElementById('run-btn') as HTMLButtonElement;
      const settled = new Promise<void>((resolve) => {
        const obs = new MutationObserver(() => {
          if (results.getAttribute('aria-busy') === 'false') {
            obs.disconnect();
            resolve();
          }
        });
        obs.observe(results, { attributes: true, attributeFilter: ['aria-busy'] });
      });
      const started = performance.now();
      btn.click();
      const during = {
        busy: results.getAttribute('aria-busy'),
        status: results.querySelector('.status')?.textContent?.trim() ?? '',
        disabled: btn.disabled,
        cards: results.querySelectorAll('.result-card').length,
      };
      await settled;
      return {
        during,
        after: {
          busy: results.getAttribute('aria-busy'),
          disabled: btn.disabled,
          elapsedMs: performance.now() - started,
        },
      };
    });
    expect(trace.during.busy).toBe('true');
    expect(trace.during.status).toContain('Running benchmarks');
    expect(trace.during.disabled).toBe(true);
    expect(trace.during.cards).toBe(0);
    expect(trace.after.busy).toBe('false');
    expect(trace.after.disabled).toBe(false);
    // The default parameters really are expensive: a run that returned
    // instantly would mean the cost knobs never reached the KDFs.
    expect(trace.after.elapsedMs).toBeGreaterThan(50);

    await expect(page.locator('.result-cards')).toBeVisible({ timeout: 180_000 });
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#run-btn')).toBeEnabled();

    const cards = await readCards(page);
    expect(cards.map((c) => c.kdf)).toEqual([
      'HKDF-SHA256',
      'PBKDF2-SHA256',
      'scrypt',
      'Argon2id',
    ]);

    // Every card derived a real 32-byte key (16 bytes previewed as 32 hex chars).
    for (const c of cards) {
      expect(c.keyHex, `${c.kdf} key preview`).toMatch(/^[0-9a-f]{32}$/);
      expect(c.params.outputLength).toBe(32);
      expect(c.timeMs).toBeGreaterThan(0);
    }
    // Distinct algorithms on the same password+salt must not agree.
    expect(new Set(cards.map((c) => c.keyHex)).size).toBe(4);

    // Nominal memory is not a decoration: it is each algorithm's defined
    // working set, recomputed here from the parameters the same card prints.
    const [hkdf, pbkdf2, scrypt, argon2] = cards;
    expect(hkdf.memoryKB).toBe(1);
    expect(pbkdf2.memoryKB).toBe(1);
    expect(scrypt.memoryKB).toBe(
      Math.round((128 * Number(scrypt.params.N) * Number(scrypt.params.r)) / 1024),
    );
    expect(argon2.memoryKB).toBe(Number(argon2.params.memory));

    // The compute-hard pair must be visibly cheaper in RAM than the memory-hard
    // pair — the demo's entire thesis, stated as an ordering, not a threshold.
    expect(scrypt.memoryKB).toBeGreaterThan(1000 * pbkdf2.memoryKB);
    expect(argon2.memoryKB).toBeGreaterThan(1000 * hkdf.memoryKB);

    // HKDF has no cost knob, so it must finish far ahead of the password KDFs.
    expect(hkdf.timeMs).toBeLessThan(pbkdf2.timeMs);
    expect(hkdf.timeMs).toBeLessThan(argon2.timeMs);
  });

  test("each card's attacker estimate is the model applied to that card's own time and memory", async ({
    page,
  }) => {
    await page.goto('.');
    await setFastParams(page);
    await runBench(page);

    for (const c of await readCards(page)) {
      // The card prints its time rounded to 0.1 ms and its rate to two
      // significant figures, so the honest check is that the rate lies in the
      // band the model produces across that rounding interval, ±5% for the
      // rate's own rounding. Sloppier than exact equality, but still catches a
      // dropped memory term, a swapped min/max, or a rate off by any factor.
      const rateFor = (ms: number): number => {
        const timeSec = Math.max(ms, 0.001) / 1000;
        return Math.min(RIG_LANES / timeSec, RIG_RAM_KB / Math.max(c.memoryKB, 1) / timeSec);
      };
      const hi = rateFor(Math.max(c.timeMs - 0.05, 0.001)) * 1.05;
      const lo = rateFor(c.timeMs + 0.05) * 0.95;
      expect(c.rate, `${c.kdf} guesses/sec`).toBeGreaterThanOrEqual(lo);
      expect(c.rate, `${c.kdf} guesses/sec`).toBeLessThanOrEqual(hi);

      const timeSec = Math.max(c.timeMs, 0.001) / 1000;
      const computeRate = RIG_LANES / timeSec;
      const memoryRate = RIG_RAM_KB / Math.max(c.memoryKB, 1) / timeSec;
      expect(c.bound, `${c.kdf} bottleneck`).toBe(
        memoryRate < computeRate ? 'RAM-bound' : 'compute-bound',
      );
    }
  });

  test('the RAM-bound label follows the memory wall, not the algorithm name', async ({ page }) => {
    await page.goto('.');
    // 128 MiB/guess: only 64 of the rig's 8,192 lanes fit, so Argon2id is RAM-bound.
    await setFastParams(page, { '#argon2-memory': '131072' });
    await runBench(page);
    await expect(page.locator('.result-card', { hasText: 'Argon2id' }).locator('.attacker-bound')).toHaveText(
      'RAM-bound',
    );
    // 512 KiB/guess: 16,384 guesses would fit in 8 GiB — more than the rig has
    // lanes — so the SAME algorithm now reports compute-bound. The label is
    // derived from the numbers, not hardcoded per KDF.
    await setFastParams(page, { '#argon2-memory': '512' });
    await runBench(page);
    await expect(page.locator('.result-card', { hasText: 'Argon2id' }).locator('.attacker-bound')).toHaveText(
      'compute-bound',
    );
  });

  test('the timing chart bars are the times on the cards', async ({ page }) => {
    await page.goto('.');
    await setFastParams(page);
    await runBench(page);

    const cards = await readCards(page);
    const maxTime = Math.max(...cards.map((c) => c.timeMs));
    const bars = await page.$$eval('.charts .bar-chart:not(#mem-chart) .bar-row', (rows) =>
      rows.map((r) => ({
        label: r.querySelector('.bar-label')?.textContent ?? '',
        width: parseFloat((r.querySelector('.bar-fill') as HTMLElement).style.width),
        now: Number(r.querySelector('.bar-track')?.getAttribute('aria-valuenow')),
        max: Number(r.querySelector('.bar-track')?.getAttribute('aria-valuemax')),
      })),
    );
    expect(bars.map((b) => b.label)).toEqual(cards.map((c) => c.kdf));
    for (let i = 0; i < bars.length; i++) {
      expect(bars[i].now, `${bars[i].label} meter value`).toBeCloseTo(cards[i].timeMs, 1);
      expect(bars[i].max, `${bars[i].label} meter max`).toBeCloseTo(maxTime, 1);
      // Bar width is the honest fraction of the slowest KDF.
      expect(bars[i].width, `${bars[i].label} bar width`).toBeCloseTo(
        (cards[i].timeMs / maxTime) * 100,
        0,
      );
    }
    expect(Math.max(...bars.map((b) => b.width))).toBeCloseTo(100, 0);
  });
});

test.describe('memory-hardness is drawn to a true linear scale', () => {
  test.slow();

  test('the grids at the shipped defaults fill in proportion to real memory', async ({ page }) => {
    await page.goto('.');
    await runBench(page);

    const cards = await readCards(page);
    const mem = cards.map((c) => Math.max(c.memoryKB, 1));
    const maxMem = Math.max(...mem);
    const grids = await page.$$eval('.mem-fig', (figs) =>
      figs.map((f) => ({
        kdf: f.querySelector('.mem-figcap-kdf')?.textContent ?? '',
        cells: f.querySelectorAll('.mem-cell').length,
        filled: f.querySelectorAll('.mem-cell-filled').length,
        aria: f.querySelector('.mem-grid')?.getAttribute('aria-label') ?? '',
      })),
    );
    expect(grids.map((g) => g.kdf)).toEqual(cards.map((c) => c.kdf));

    for (let i = 0; i < grids.length; i++) {
      expect(grids[i].cells, 'same-size grids').toBe(144);
      // The lit-cell count IS the memory ratio, on a linear scale, floored at
      // one cell. Nothing here is a picture chosen by hand.
      expect(grids[i].filled, `${grids[i].kdf} lit cells`).toBe(
        Math.max(1, Math.round(Math.min(1, mem[i] / maxMem) * 144)),
      );
    }
    // README's visually-confirmable promise at the defaults: scrypt (128 MiB)
    // fills its grid, Argon2id (64 MiB) fills half, and the compute-hard pair
    // light one lonely cell each.
    expect(grids[2].filled).toBe(144);
    expect(grids[3].filled).toBe(72);
    expect(grids[0].filled).toBe(1);
    expect(grids[1].filled).toBe(1);
    expect(grids[0].aria).toContain('<1%');
    expect(grids[2].aria).toContain('~100%');
  });

  test('the caption quotes the ratio this run produced, and names the hungriest KDF', async ({
    page,
  }) => {
    await page.goto('.');
    // Deliberately make Argon2id — not scrypt — the hungriest, so a caption
    // hardcoded to the shipped defaults cannot pass.
    await setFastParams(page, { '#scrypt-n': '1024', '#argon2-memory': '16384' });
    await runBench(page);

    const cards = await readCards(page);
    const mem = cards.map((c) => Math.max(c.memoryKB, 1));
    const ratio = Math.max(...mem) / Math.min(...mem);
    // approxRatio(): two significant figures.
    const mag = 10 ** (Math.floor(Math.log10(ratio)) - 1);
    const expected = `${(Math.round(ratio / mag) * mag).toLocaleString('en-US')}×`;

    const caption = page.locator('.mem-showcase-cap');
    await expect(caption).toContainText(`Argon2id, the hungriest KDF`);
    await expect(caption).toContainText(expected);
    await expect(caption).toContainText('16 MiB');
    // The chart carries the same run-derived ratio for its captions.
    await expect(page.locator('#mem-chart')).toHaveAttribute('data-ratio', expected);
  });

  test('the memory chart opens on linear and the log toggle recomputes every bar', async ({
    page,
  }) => {
    await page.goto('.');
    await setFastParams(page);
    await runBench(page);

    const cards = await readCards(page);
    const mem = cards.map((c) => Math.max(c.memoryKB, 1));
    const maxMem = Math.max(...mem);
    const maxLog = Math.max(...mem.map((m) => Math.log10(m)), 1);
    const widths = (): Promise<number[]> =>
      page.$$eval('#mem-chart .bar-fill-mem', (fs) =>
        fs.map((f) => parseFloat((f as HTMLElement).style.width) || 0),
      );

    // Default = linear: the honest ratio, before it is compressed.
    await expect(page.locator('#mem-chart')).toHaveAttribute('data-scale', 'linear');
    await expect(page.locator('.scale-btn[data-scale-set="linear"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const ratio = await page.locator('#mem-chart').getAttribute('data-ratio');
    await expect(page.locator('#mem-scale-note')).toContainText('Linear scale');
    await expect(page.locator('#mem-scale-note')).toContainText(String(ratio));

    const lin = await widths();
    for (let i = 0; i < lin.length; i++) {
      expect(lin[i], `${cards[i].kdf} linear bar`).toBeCloseTo((mem[i] / maxMem) * 100, 1);
    }

    await page.locator('.scale-btn[data-scale-set="log"]').click();
    await expect(page.locator('#mem-chart')).toHaveAttribute('data-scale', 'log');
    await expect(page.locator('.scale-btn[data-scale-set="log"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.scale-btn[data-scale-set="linear"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const log = await widths();
    for (let i = 0; i < log.length; i++) {
      expect(log[i], `${cards[i].kdf} log bar`).toBeCloseTo((Math.log10(mem[i]) / maxLog) * 100, 1);
    }
    // Log must actually lift the middle bars toward the top — that compression
    // is the whole reason the toggle exists (and the reason linear is default).
    const middle = mem.findIndex((m) => m > Math.min(...mem) && m < Math.max(...mem));
    expect(middle, 'a bar between the leanest and the hungriest').toBeGreaterThan(-1);
    expect(log[middle]).toBeGreaterThan(lin[middle]);
    // Linear keeps the hungriest at the top on both scales.
    expect(Math.max(...lin)).toBeCloseTo(100, 1);
    expect(Math.max(...log)).toBeCloseTo(100, 1);
    // …and the caption must warn that it flattened the real gap it still quotes.
    await expect(page.locator('#mem-scale-note')).toContainText('Log scale');
    await expect(page.locator('#mem-scale-note')).toContainText('flattens');
    await expect(page.locator('#mem-scale-note')).toContainText(String(ratio));

    await page.locator('.scale-btn[data-scale-set="linear"]').click();
    expect(await widths()).toEqual(lin);
  });
});

test.describe('the RAM-wall rig is the attacker model, watched', () => {
  test.slow();

  test('lanes that fit plus lanes that idle equal the rig, at both branches', async ({ page }) => {
    await page.goto('.');
    await setFastParams(page);
    await runBench(page);

    const status = page.locator('#rig-status');
    const setSlider = (kib: number): Promise<void> =>
      page.locator('#rig-argon-mem').evaluate((el, v) => {
        (el as HTMLInputElement).value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, kib);

    // 1 GiB per guess: the RAM wall bites.
    await setSlider(1_048_576);
    const fit = Math.floor(RIG_RAM_KB / 1_048_576);
    await expect(status).toContainText('RAM-bound');
    await expect(status).toContainText(`only ${fit.toLocaleString('en-US')} of the rig’s`);
    await expect(status).toContainText(
      `${(RIG_LANES - fit).toLocaleString('en-US')} sit idle`,
    );
    // The three figures the status quotes must partition the rig: working lanes
    // + idle lanes = total cores, all read back off the rendered sentence.
    const text = (await status.textContent()) ?? '';
    const working = num(text.match(/only ([\d,]+) of the rig/)?.[1] ?? '');
    const total = num(text.match(/of the rig.s ([\d,]+) cores/)?.[1] ?? '');
    const idle = num(text.match(/other ([\d,]+) sit idle/)?.[1] ?? '');
    expect(working).toBe(fit);
    expect(total).toBe(RIG_LANES);
    expect(working + idle).toBe(total);
    // The board lights the same fraction of tokens that the model says works.
    expect(await page.locator('.rig-token-fit').count()).toBe(
      Math.max(1, Math.round(Math.min(1, fit / RIG_LANES) * 120)),
    );
    expect(
      (await page.locator('.rig-token-fit').count()) + (await page.locator('.rig-token-idle').count()),
    ).toBe(120);

    // 512 KiB per guess: 16,384 would fit, more than the rig has lanes, so the
    // page must cross to the compute-bound branch it advertises.
    await setSlider(512);
    await expect(status).toContainText('Compute-bound');
    await expect(status).toContainText(`all ${RIG_LANES.toLocaleString('en-US')} cores run`);
    expect(await page.locator('.rig-token-fit').count()).toBe(120);
    expect(await page.locator('.rig-token-idle').count()).toBe(0);
  });

  test('the rig slider really re-parameterises the next benchmark', async ({ page }) => {
    await page.goto('.');
    await setFastParams(page);
    await runBench(page);

    await page.locator('#rig-argon-mem').evaluate((el) => {
      (el as HTMLInputElement).value = '4096';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#rig-argon-out')).toHaveText('4,096');
    await expect(page.locator('#argon2-memory')).toHaveValue('4096');

    await runBench(page);
    const argon = (await readCards(page)).find((c) => c.kdf === 'Argon2id')!;
    expect(argon.params.memory).toBe(4096);
    expect(argon.memoryKB).toBe(4096);
  });
});

test.describe('failure and tamper paths', () => {
  test.slow();

  test('an invalid scrypt N fails loudly, says why, and is recoverable', async ({ page }) => {
    await page.goto('.');
    await setFastParams(page, { '#scrypt-n': '3' });

    await page.locator('#run-btn').click();
    const error = page.locator('#results .status-error');
    await expect(error).toBeVisible({ timeout: 60_000 });
    await expect(error).toHaveAttribute('role', 'alert');
    // Not just "something went wrong" — the message names the broken constraint.
    await expect(error).toContainText(/power of 2/i);
    await expect(error).toContainText('N');
    // The failure state is clean: no stale results, live region settled, button back.
    await expect(page.locator('.result-cards')).toHaveCount(0);
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#run-btn')).toBeEnabled();

    // …and the page recovers rather than dead-ending.
    await page.fill('#scrypt-n', '2048');
    await runBench(page);
    await expect(page.locator('#results .status-error')).toHaveCount(0);
    await expect(page.locator('.result-card')).toHaveCount(4);
  });

  test('an empty password refuses to run and puts the cursor where the fix is', async ({ page }) => {
    await page.goto('.');
    await page.fill('#password-input', '');
    await page.locator('#run-btn').click();
    await expect(page.locator('.results-placeholder')).toBeVisible();
    await expect(page.locator('.result-cards')).toHaveCount(0);
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('password-input');
  });

  test('a blank cost field falls back to its default instead of deriving with zero cost', async ({
    page,
  }) => {
    await page.goto('.');
    await setFastParams(page);
    await page.fill('#scrypt-r', '');
    await page.fill('#pbkdf2-iterations', '');
    await runBench(page);

    const cards = await readCards(page);
    // Blank must not become 0/NaN iterations — that would silently derive a key
    // with no cost at all while the UI still claimed a benchmark.
    expect(cards[1].params.iterations).toBe(600000);
    expect(cards[2].params.r).toBe(8);
    expect(cards[2].memoryKB).toBe(
      Math.round((128 * Number(cards[2].params.N) * Number(cards[2].params.r)) / 1024),
    );
  });

  test('salt reuse reproduces identical keys and the callout explains the failure', async ({
    page,
  }) => {
    await page.goto('.');
    await setFastParams(page);

    const keys = (): Promise<string[]> =>
      page.$$eval('.output-preview code', (cs) => cs.map((c) => c.textContent ?? ''));
    const saltHex = async (): Promise<string> =>
      (await page.locator('.salt-callout code').first().textContent()) ?? '';

    // Correct mode: a fresh random salt per run, so nothing repeats.
    await runBench(page);
    const first = await keys();
    const firstSalt = await saltHex();
    expect(firstSalt).toMatch(/^[0-9a-f]{32}$/);
    await expect(page.locator('.salt-callout')).toContainText('rainbow tables');
    await expect(page.locator('.salt-callout-warn')).toHaveCount(0);

    await runBench(page);
    const second = await keys();
    expect(await saltHex()).not.toBe(firstSalt);
    for (let i = 0; i < first.length; i++) expect(second[i]).not.toBe(first[i]);

    // Tamper mode: pin the salt and the same password now repeats its keys —
    // the rainbow-table failure the page exists to show.
    await page.check('#reuse-salt');
    await runBench(page);
    const pinned = await keys();
    const pinnedSalt = await saltHex();
    await runBench(page);
    expect(await keys()).toEqual(pinned);
    expect(await saltHex()).toBe(pinnedSalt);

    const warn = page.locator('.salt-callout-warn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('Salt reuse is ON (insecure demo mode)');
    await expect(warn).toContainText('rainbow tables');
    await expect(warn).toContainText(pinnedSalt);

    // Unchecking restores correct behaviour — the tamper is reversible.
    await page.uncheck('#reuse-salt');
    await runBench(page);
    expect(await keys()).not.toEqual(pinned);
    await expect(page.locator('.salt-callout-warn')).toHaveCount(0);
  });

  test('the PBKDF2 weaken preset flips the knob and the attacker gets faster', async ({ page }) => {
    await page.goto('.');
    await setFastParams(page, { '#pbkdf2-iterations': '600000' });

    const preset = page.locator('.preset-btn[data-preset-target="pbkdf2-iterations"]');
    await expect(preset).toHaveAttribute('aria-pressed', 'false');
    await runBench(page);
    const strong = (await readCards(page))[1];
    expect(strong.params.iterations).toBe(600000);

    await preset.click();
    await expect(preset).toHaveAttribute('aria-pressed', 'true');
    await expect(preset).toHaveText('Restore strong default');
    await expect(page.locator('#pbkdf2-iterations')).toHaveValue('1000');
    // The preset must reveal the change, not bury it in a collapsed panel.
    expect(await page.evaluate(() => (document.getElementById('params-advanced') as HTMLDetailsElement).open)).toBe(true);

    await runBench(page);
    const weak = (await readCards(page))[1];
    expect(weak.params.iterations).toBe(1000);
    // 600x fewer iterations: faster to derive and correspondingly cheaper to
    // attack. Asserted as an ordering, not a wall-clock threshold.
    expect(weak.timeMs).toBeLessThan(strong.timeMs);
    expect(weak.rate).toBeGreaterThan(strong.rate);
    expect(weak.keyHex).not.toBe(strong.keyHex);

    await preset.click();
    await expect(preset).toHaveAttribute('aria-pressed', 'false');
    await expect(preset).toHaveText('Weaken: 1,000 iterations');
    await expect(page.locator('#pbkdf2-iterations')).toHaveValue('600000');
  });

  test('the Argon2id weaken preset shrinks the RAM wall the page then reports', async ({ page }) => {
    await page.goto('.');
    await setFastParams(page, { '#argon2-memory': '65536' });
    await runBench(page);
    const strong = (await readCards(page))[3];
    expect(strong.memoryKB).toBe(65536);

    const preset = page.locator('.preset-btn[data-preset-target="argon2-memory"]');
    await preset.click();
    await expect(page.locator('#argon2-memory')).toHaveValue('8192');
    await runBench(page);

    const weak = (await readCards(page))[3];
    expect(weak.memoryKB).toBe(8192);
    expect(weak.params.memory).toBe(8192);
    // 8x less RAM per guess is 8x more concurrent guesses for a fixed-RAM rig.
    expect(strong.memoryKB / weak.memoryKB).toBe(8);
    // The grid must restate itself rather than leaving the strong figure up.
    await expect(page.locator('.mem-fig').nth(3).locator('.mem-figcap-size')).toHaveText('8 MiB');
  });
});

test.describe('the teaching content the README promises is on the page', () => {
  test.slow();

  test('the intro frames compute- vs memory-hardness and flags HKDF as the wrong tool', async ({
    page,
  }) => {
    await page.goto('.');
    const intro = page.locator('.intro');
    await expect(intro).toContainText('key derivation function');
    await expect(intro).toContainText('compute-hard');
    await expect(intro).toContainText('memory-hard');
    await expect(intro).toContainText('wrong tool');
    // Glossary: five terms, collapsible, present before any run.
    await expect(page.locator('#glossary .glossary-list dt')).toHaveCount(5);
    await expect(page.locator('#glossary')).toContainText('extract-and-expand');
    await expect(page.locator('#glossary')).toContainText('KiB');
  });

  test('each schematic draws the mechanism its KDF actually used', async ({ page }) => {
    await page.goto('.');
    await setFastParams(page, { '#pbkdf2-iterations': '12345' });
    await runBench(page);

    // PBKDF2: the loop counter is the iteration count that ran, not a stock number.
    const counter = page.locator('.schematic-pbkdf2 .sch-counter');
    await expect(counter).toHaveAttribute('data-count', '12345');
    await expect(counter).toContainText('12,345');
    await expect(page.locator('.result-card', { hasText: 'PBKDF2' }).locator('.params')).toContainText(
      'iterations: 12345',
    );
    await expect(page.locator('.schematic-pbkdf2 .sch-note')).toContainText('Compute-hard');

    // HKDF: extract → expand, and the honest "no cost knob" admission.
    await expect(page.locator('.schematic-hkdf .sch-box-extract')).toContainText('extract');
    await expect(page.locator('.schematic-hkdf .sch-box-expand')).toContainText('expand');
    await expect(page.locator('.schematic-hkdf .sch-note')).toContainText('no cost knob');
    await expect(page.locator('.result-card', { hasText: 'HKDF' }).locator('.note')).toContainText(
      'HKDF is NOT a password KDF',
    );

    // scrypt + Argon2id: a block array, one schematic each.
    await expect(page.locator('.schematic-mem')).toHaveCount(2);
    await expect(page.locator('.schematic-mem .sch-note').first()).toContainText('Memory-hard');
    expect(await page.locator('.schematic-mem').first().locator('.sch-block').count()).toBeGreaterThan(3);
  });

  test('the memory figure is labelled defined-not-measured on every card', async ({ page }) => {
    await page.goto('.');
    await setFastParams(page);
    await runBench(page);
    await expect(page.locator('.memory-caveat')).toHaveCount(4);
    for (const t of await page.locator('.memory-caveat').allTextContents()) {
      expect(t).toContain('(defined, not measured)');
    }
    // The attacker tooltip names the hypothetical rig the estimate came from.
    const title = await page.locator('.attacker').first().getAttribute('title');
    expect(title).toContain(`${RIG_LANES.toLocaleString('en-US')}-lane`);
    expect(title).toContain('8 GiB');
    expect(title).toMatch(/estimate/i);
  });
});
