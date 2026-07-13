import { estimateAttacker, ATTACKER, type BenchResult } from './bench.ts';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Format a guesses/sec figure into human-readable "order of magnitude" prose.
 * The attacker model is explicitly an estimate (see bench.ts), so we round hard
 * to scientific-ish suffixes rather than implying false precision.
 */
function formatRate(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(n >= 1e13 ? 0 : 1)} trillion`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} thousand`;
  return n.toFixed(0);
}

/** Human-readable memory size from a KiB figure. */
function humanKB(memKB: number): string {
  if (memKB >= 1024 * 1024) return `${(memKB / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`;
  if (memKB >= 1024) return `${(memKB / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} MiB`;
  return `~${memKB.toLocaleString()} KB`;
}

/**
 * A LINEAR-scaled grid of memory cells that fills in proportion to the KDF's
 * nominal working set, measured against the largest KDF in the same run. This is
 * an HONEST visual: the fill fraction is the real ratio of `memoryNominalKB`
 * figures, never faked and never log-compressed. Rendered for ALL four KDFs so
 * PBKDF2/HKDF read as one lonely lit cell directly beside Argon2id's nearly-full
 * grid — the side-by-side emptiness-vs-fullness is what makes "memory-hard" click.
 */
function memoryFillGrid(memKB: number, maxMemKB: number, kdf: string): string {
  const COLS = 12;
  const ROWS = 12;
  const CELLS = COLS * ROWS; // 144-cell grid, one lit cell ≈ 1/144 of the biggest KDF
  const frac = maxMemKB > 0 ? Math.min(1, Math.max(0, memKB / maxMemKB)) : 0;
  // At least one lit cell so a tiny KDF still shows a single spark rather than
  // a fully-dark grid (it has SOME working set — it is just negligible).
  const filled = Math.max(1, Math.round(frac * CELLS));
  let cells = '';
  for (let i = 0; i < CELLS; i++) {
    cells += `<span class="mem-cell${i < filled ? ' mem-cell-filled' : ''}"></span>`;
  }
  const pctText = frac >= 0.995 ? '~100%' : frac < 0.01 ? '<1%' : `${Math.round(frac * 100)}%`;
  return `
    <figure class="mem-fig">
      <div class="mem-grid" role="img" aria-label="${escapeHtml(kdf)} fills ${pctText} of the largest KDF's per-guess memory (${humanKB(memKB)}).">${cells}</div>
      <figcaption class="mem-figcap"><span class="mem-figcap-kdf">${escapeHtml(kdf)}</span><span class="mem-figcap-size">${humanKB(memKB)}</span></figcaption>
    </figure>`;
}

/**
 * The four side-by-side memory grids, on one linear scale. This is the single
 * strongest way to make "memory-hard" visible: three near-dark grids next to
 * one near-full grid.
 */
function memoryGridRow(results: BenchResult[]): string {
  const maxMemKB = Math.max(...results.map((r) => Math.max(r.memoryNominalKB, 1)));
  const grids = results.map((r) => memoryFillGrid(Math.max(r.memoryNominalKB, 1), maxMemKB, r.kdf)).join('');
  return `
    <section class="mem-showcase" aria-labelledby="mem-showcase-h">
      <h2 class="mem-showcase-h" id="mem-showcase-h">Per-guess memory, drawn to scale</h2>
      <p class="mem-showcase-cap">Each grid is the same size and each grid is drawn to the <strong>same true linear scale</strong> (all four measured against the hungriest KDF in this run). A lit cell is a slice of the RAM one password guess must hold. The two compute-hard KDFs — HKDF and PBKDF2 — barely light a single cell; the two memory-hard ones — scrypt and Argon2id — fill most of theirs. <em>That</em> emptiness-vs-fullness, at the honest ~64,000&times; ratio a log axis would have hidden, is memory-hardness.</p>
      <div class="mem-grid-row">${grids}</div>
    </section>`;
}

/**
 * A schematic of each KDF's inner loop — the mechanism the prose describes,
 * drawn so "compute-hard = repeat a hash" and "memory-hard = fill and revisit
 * RAM" become an observed process rather than a label. Static, annotated, honest:
 * block counts are illustrative (labelled as such), not a live trace.
 */
function kdfSchematic(r: BenchResult): string {
  const kdf = r.kdf;
  if (kdf.startsWith('HKDF')) {
    return `
      <div class="schematic schematic-hkdf" role="img" aria-label="HKDF schematic: an extract box feeding an expand box. No cost knob.">
        <div class="sch-row">
          <span class="sch-box sch-box-extract">extract<small>HMAC once</small></span>
          <span class="sch-arrow" aria-hidden="true">&rarr;</span>
          <span class="sch-box sch-box-expand">expand<small>HMAC once</small></span>
        </div>
        <p class="sch-note">Two HMAC calls, no repetition — <strong>no cost knob to slow a guesser</strong>.</p>
      </div>`;
  }
  if (kdf.startsWith('PBKDF2')) {
    const iters = Number(r.params.iterations) || 0;
    return `
      <div class="schematic schematic-pbkdf2" role="img" aria-label="PBKDF2 schematic: one hash repeated ${iters.toLocaleString()} times in a loop, tiny fixed memory.">
        <div class="sch-loop">
          <span class="sch-loop-label" aria-hidden="true">&#8635; loop</span>
          <span class="sch-box sch-box-hash">hash</span>
          <span class="sch-counter" data-count="${iters}">&times;<span class="sch-counter-n">${iters.toLocaleString()}</span></span>
        </div>
        <p class="sch-note"><strong>Compute-hard:</strong> repeat one cheap hash. A GPU runs thousands of these loops in parallel — memory stays near zero.</p>
      </div>`;
  }
  // scrypt / Argon2id — memory-hard: write then re-read a big array of blocks.
  const blocks = Math.max(4, Math.min(32, Math.round(r.memoryNominalKB / 64)));
  let cells = '';
  for (let i = 0; i < blocks; i++) cells += `<span class="sch-block" style="--b:${i}"></span>`;
  const label = kdf.startsWith('scrypt') ? 'scrypt' : 'Argon2id';
  return `
    <div class="schematic schematic-mem" role="img" aria-label="${label} schematic: a large array of memory blocks written then re-read in a data-dependent order.">
      <div class="sch-blocks">${cells}</div>
      <p class="sch-note"><strong>Memory-hard:</strong> fill a large array of RAM blocks, then re-read them in a password-dependent order. Skipping the RAM changes the answer — so an attacker must <em>pay the RAM</em> for every guess.</p>
    </div>`;
}

export interface RenderMeta {
  saltReused: boolean;
  salt: Uint8Array;
}

export function renderResults(results: BenchResult[], meta?: RenderMeta): string {
  const maxTime = Math.max(...results.map((r) => r.timeMs));
  const attacks = results.map((r) => estimateAttacker(r));
  const maxMemKB = Math.max(...results.map((r) => Math.max(r.memoryNominalKB, 1)));

  const cards = results
    .map((r, i) => {
      const paramsStr = Object.entries(r.params)
        .map(([k, v]) => `${escapeHtml(String(k))}: ${escapeHtml(String(v))}`)
        .join(', ');
      const hexPreview = toHex(r.output).slice(0, 32) + '…';
      const note = r.note ? `<p class="note">${escapeHtml(r.note)}</p>` : '';
      const atk = attacks[i];
      const boundLabel = atk.boundedBy === 'memory' ? 'RAM-bound' : 'compute-bound';

      return `
      <li class="result-card">
        <h3>${escapeHtml(r.kdf)}</h3>
        <p class="time">${r.timeMs.toFixed(1)}<span class="time-unit"> ms</span></p>
        <p class="params">${paramsStr}</p>
        ${kdfSchematic(r)}
        <p class="memory">Nominal memory: ~${r.memoryNominalKB.toLocaleString()} KB <span class="memory-caveat" title="Algorithm-defined working-set size, not measured RAM. HKDF/PBKDF2 are compute-bound, so their footprint is tiny and approximate.">(defined, not measured)</span></p>
        <p class="attacker" title="Order-of-magnitude estimate from this run's time and the algorithm's defined memory cost, against one hypothetical 8192-lane, 8 GiB rig. Not a benchmark of any real GPU.">
          <span class="attacker-label">Attacker: </span>
          <span class="attacker-rate">~${formatRate(atk.guessesPerSec)}</span> guesses/sec
          <span class="attacker-bound attacker-bound-${atk.boundedBy}">${boundLabel}</span>
        </p>
        <p class="output-preview">Derived key: <code>${hexPreview}</code></p>
        ${note}
      </li>`;
    })
    .join('');

  const timeBars = results
    .map((r) => {
      const pct = maxTime > 0 ? (r.timeMs / maxTime) * 100 : 0;
      const labelId = `bar-t-${r.kdf.replace(/\W/g, '')}`;
      const valueText = `${r.timeMs.toFixed(1)} milliseconds`;
      return `
      <div class="bar-row">
        <span class="bar-label" id="${labelId}">${escapeHtml(r.kdf)}</span>
        <div class="bar-track" role="meter" aria-valuenow="${r.timeMs.toFixed(1)}" aria-valuemin="0" aria-valuemax="${maxTime.toFixed(1)}" aria-valuetext="${valueText}" aria-labelledby="${labelId}"><div class="bar-fill" style="width: ${pct.toFixed(1)}%"></div></div>
        <span class="bar-value" aria-hidden="true">${r.timeMs.toFixed(1)} ms</span>
      </div>`;
    })
    .join('');

  // Both scalings precomputed; a toggle swaps a data-attribute and the bar
  // widths recompute in JS (see wireMemChartToggle). Default = LINEAR, so the
  // learner feels the honest 64,000x gap before it is compressed for legibility.
  const maxMemLog = Math.max(...results.map((r) => Math.log10(Math.max(r.memoryNominalKB, 1))), 1);
  const memBars = results
    .map((r) => {
      const memKB = Math.max(r.memoryNominalKB, 1);
      const linPct = (memKB / maxMemKB) * 100;
      const logPct = (Math.log10(memKB) / maxMemLog) * 100;
      const labelId = `bar-m-${r.kdf.replace(/\W/g, '')}`;
      const valueText = `${r.memoryNominalKB.toLocaleString()} kilobytes per guess`;
      return `
      <div class="bar-row">
        <span class="bar-label" id="${labelId}">${escapeHtml(r.kdf)}</span>
        <div class="bar-track" role="meter" aria-valuenow="${r.memoryNominalKB}" aria-valuemin="1" aria-valuemax="${Math.round(10 ** maxMemLog)}" aria-valuetext="${valueText}" aria-labelledby="${labelId}"><div class="bar-fill bar-fill-mem" data-lin="${linPct.toFixed(2)}" data-log="${logPct.toFixed(2)}" style="width: ${linPct.toFixed(2)}%"></div></div>
        <span class="bar-value" aria-hidden="true">${humanKB(memKB)}</span>
      </div>`;
    })
    .join('');

  const saltHex = meta ? toHex(meta.salt) : '';
  const saltCallout = meta
    ? meta.saltReused
      ? `<div class="salt-callout salt-callout-warn" role="note">
           <strong>Salt reuse is ON (insecure demo mode).</strong> The same salt
           <code>${escapeHtml(saltHex)}</code> is pinned across runs, so an identical
           password now derives the <em>same</em> key every time — exactly the
           precomputation weakness (rainbow tables) that a per-user random salt exists
           to defeat. Uncheck to restore correct behaviour.
         </div>`
      : `<div class="salt-callout" role="note">
           <strong>Why did the key change?</strong> Each run draws a fresh random salt
           (<code>${escapeHtml(saltHex)}</code>), so the same password derives a
           different key every time. That is the point: unique salts make precomputed
           rainbow tables useless. Flip <em>Reuse salt across runs</em> above to watch
           identical keys reappear.
         </div>`
    : '';

  return `
    <h2 class="section-heading">Results</h2>
    <ul class="result-cards" role="list">${cards}</ul>
    ${saltCallout}
    ${memoryGridRow(results)}
    ${attackerRig(results)}
    <div class="charts">
      <div class="bar-chart">
        <h2>Defender cost: wall-clock time</h2>
        <p class="chart-caption">How long one derivation takes on this machine. Longer is safer — but only up to what your users will tolerate.</p>
        ${timeBars}
      </div>
      <div class="bar-chart" id="mem-chart" data-scale="linear">
        <div class="chart-head">
          <h2>Attacker's per-guess memory cost</h2>
          <div class="scale-toggle" role="group" aria-label="Memory chart scale">
            <button type="button" class="scale-btn is-active" data-scale-set="linear" aria-pressed="true">Linear</button>
            <button type="button" class="scale-btn" data-scale-set="log" aria-pressed="false">Log</button>
          </div>
        </div>
        <p class="chart-caption" id="mem-scale-note">Linear scale — the true ratio. The memory-hard bars dwarf PBKDF2/HKDF because they really do cost tens of thousands of times more RAM per guess. Switch to <strong>Log</strong> to compress the axis so the tiny bars become readable.</p>
        ${memBars}
      </div>
    </div>`;
}

/**
 * Attacker-rig animation. A fixed pool of RAM (the bar) and a fixed pool of
 * compute lanes; each in-flight guess claims `perGuessKB` of RAM. For PBKDF2 the
 * RAM is negligible so thousands of lanes pack in and COMPUTE is the wall; for
 * Argon2id only a handful of guesses fit before the RAM bar is full and the
 * remaining cores sit idle. The Argon2id memory slider lets the learner watch
 * lanes get evicted in real time — turning the asserted "RAM-bound" label into an
 * observed mechanism.
 */
function attackerRig(results: BenchResult[]): string {
  const argon = results.find((r) => r.kdf.startsWith('Argon2id'));
  const argonMem = argon ? argon.memoryNominalKB : 65536;
  return `
    <section class="rig" aria-labelledby="rig-h">
      <h2 class="rig-h" id="rig-h">The RAM wall: why more cores stop helping</h2>
      <p class="rig-cap">One attacker box has a fixed pool of fast RAM and thousands of compute lanes. Every in-flight guess must hold its whole working set in that RAM. For a compute-hard KDF the working set is a rounding error, so lanes pack in until <em>compute</em> is the limit. For a memory-hard KDF the RAM fills after a handful of guesses and the rest of the cores <strong>sit idle</strong> — that idle silicon is the whole point of memory-hardness.</p>
      <div class="rig-lanes" id="rig-lanes" aria-hidden="true"></div>
      <p class="rig-status" id="rig-status" role="status" aria-live="polite"></p>
      <div class="rig-control">
        <label for="rig-argon-mem">Drag Argon2id memory (KiB): <output id="rig-argon-out">${argonMem.toLocaleString()}</output></label>
        <input type="range" id="rig-argon-mem" min="8192" max="1048576" step="8192" value="${Math.min(1048576, Math.max(8192, argonMem))}" />
        <p class="rig-hint">Turn it down and watch guesses pack back in; turn it up and watch lanes get evicted until only a few fit. That eviction — not raw speed — is what makes Argon2id expensive to attack.</p>
      </div>
    </section>`;
}

export function renderPlaceholder(): string {
  return `<div class="results-placeholder">Enter a password and click <strong>Run Benchmark</strong> to compare KDFs.</div>`;
}

export function renderRunning(): string {
  return `<div class="status" role="status"><span class="spinner" aria-hidden="true">&#9881;</span> Running benchmarks…</div>`;
}

/**
 * Wire the linear/log scale toggle on the per-guess memory chart. Call after
 * renderResults injects the markup. Idempotent-ish: it reads current DOM state.
 */
export function wireMemChartToggle(root: ParentNode = document): void {
  const chart = root.querySelector<HTMLElement>('#mem-chart');
  if (!chart) return;
  const note = chart.querySelector<HTMLElement>('#mem-scale-note');
  const linText =
    'Linear scale — the true ratio. The memory-hard bars dwarf PBKDF2/HKDF because they really do cost tens of thousands of times more RAM per guess. Switch to <strong>Log</strong> to compress the axis so the tiny bars become readable.';
  const logText =
    'Log scale — the axis is compressed so PBKDF2/HKDF’s tiny bars become legible. Handy for reading small values, but it visually flattens the real tens-of-thousands-fold gap you saw on the linear scale.';
  const apply = (scale: 'linear' | 'log'): void => {
    chart.setAttribute('data-scale', scale);
    chart.querySelectorAll<HTMLElement>('.bar-fill-mem').forEach((f) => {
      const pct = scale === 'log' ? f.dataset.log : f.dataset.lin;
      if (pct) f.style.width = `${pct}%`;
    });
    chart.querySelectorAll<HTMLButtonElement>('.scale-btn').forEach((b) => {
      const active = b.dataset.scaleSet === scale;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (note) note.innerHTML = scale === 'log' ? logText : linText;
  };
  chart.querySelectorAll<HTMLButtonElement>('.scale-btn').forEach((b) => {
    b.addEventListener('click', () => apply((b.dataset.scaleSet as 'linear' | 'log') ?? 'linear'));
  });
}

/**
 * Wire the attacker-rig lane visualization and its live Argon2id memory slider.
 * Renders `count` lane tokens up to a visual cap, colours the ones that fit
 * inside the fixed RAM pool, and greys out the evicted/idle remainder. Dragging
 * the slider recomputes how many fit and animates eviction/return.
 */
export function wireAttackerRig(root: ParentNode = document): void {
  const lanes = root.querySelector<HTMLElement>('#rig-lanes');
  const status = root.querySelector<HTMLElement>('#rig-status');
  const slider = root.querySelector<HTMLInputElement>('#rig-argon-mem');
  const out = root.querySelector<HTMLOutputElement>('#rig-argon-out');
  if (!lanes || !status || !slider || !out) return;

  // Visual model, faithful to the real attacker math in bench.ts: a rig with
  // ATTACKER.ramKB of RAM and ATTACKER.parallelLanes cores. Guesses that fit =
  // min(cores, RAM / per-guess-RAM). We draw a fixed TOKENS-cell board and light
  // the fraction that fits, so the same board reads for 8 fitting or 8192.
  const TOKENS = 120;
  // Build the board once.
  let cells = '';
  for (let i = 0; i < TOKENS; i++) cells += `<span class="rig-token"></span>`;
  lanes.innerHTML = cells;
  const tokens = Array.from(lanes.querySelectorAll<HTMLElement>('.rig-token'));

  function update(argonMemKB: number): void {
    const perGuessKB = Math.max(argonMemKB, 1);
    const fitByRam = Math.floor(ATTACKER.ramKB / perGuessKB);
    const fit = Math.min(ATTACKER.parallelLanes, fitByRam);
    const ramBound = fitByRam < ATTACKER.parallelLanes;
    // Fraction of the board that lights = fraction of cores that get to work.
    const litFrac = Math.min(1, fit / ATTACKER.parallelLanes);
    const lit = Math.max(1, Math.round(litFrac * TOKENS));
    tokens.forEach((t, i) => {
      t.classList.toggle('rig-token-fit', i < lit);
      t.classList.toggle('rig-token-idle', i >= lit);
    });
    const ramGiB = (ATTACKER.ramKB / (1024 * 1024)).toFixed(0);
    if (ramBound) {
      status!.innerHTML = `RAM-bound: at <strong>${humanKBLocal(argonMemKB)}</strong>/guess, only <strong>${fit.toLocaleString()}</strong> of the rig’s ${ATTACKER.parallelLanes.toLocaleString()} cores fit in ${ramGiB} GiB of RAM. The other <strong>${(ATTACKER.parallelLanes - fit).toLocaleString()}</strong> sit idle — adding more cores buys the attacker nothing.`;
    } else {
      status!.innerHTML = `Compute-bound: at <strong>${humanKBLocal(argonMemKB)}</strong>/guess the RAM is not the limit — all <strong>${ATTACKER.parallelLanes.toLocaleString()}</strong> cores run. Here the attacker <em>is</em> helped by more cores. Raise the memory to hit the RAM wall.`;
    }
    out!.textContent = argonMemKB.toLocaleString();
  }

  function humanKBLocal(memKB: number): string {
    if (memKB >= 1024 * 1024) return `${(memKB / (1024 * 1024)).toFixed(1)} GiB`;
    if (memKB >= 1024) return `${Math.round(memKB / 1024)} MiB`;
    return `${memKB} KB`;
  }

  slider.addEventListener('input', () => update(Number(slider.value)));
  update(Number(slider.value));
}
