import { estimateAttacker, type BenchResult } from './bench.ts';

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

/**
 * A small grid of memory cells that fills in proportion to the KDF's nominal
 * working set (log-scaled so PBKDF2's ~1 KB and Argon2id's 64 MiB both read on
 * one grid). This is a HONEST visual: the fill fraction is derived directly from
 * the real `memoryNominalKB` figure, never faked. It turns "memory-hard" into
 * something you see, not just a number.
 */
function memoryFillGrid(memKB: number): string {
  const CELLS = 32;
  // Log scale from 1 KB (empty-ish) to 1 GiB (full). Compute-bound KDFs land at
  // ~1-2 cells; Argon2id at 64 MiB fills most of the grid.
  const minLog = Math.log10(1); // 1 KB
  const maxLog = Math.log10(1024 * 1024); // 1 GiB in KB
  const frac = Math.min(1, Math.max(0, (Math.log10(Math.max(memKB, 1)) - minLog) / (maxLog - minLog)));
  const filled = Math.max(1, Math.round(frac * CELLS));
  let cells = '';
  for (let i = 0; i < CELLS; i++) {
    cells += `<span class="mem-cell${i < filled ? ' mem-cell-filled' : ''}"></span>`;
  }
  return `<div class="mem-grid" aria-hidden="true" style="--fill-delay:${(1 / filled).toFixed(3)}s">${cells}</div>`;
}

export interface RenderMeta {
  saltReused: boolean;
  salt: Uint8Array;
}

export function renderResults(results: BenchResult[], meta?: RenderMeta): string {
  const maxTime = Math.max(...results.map((r) => r.timeMs));
  const attacks = results.map((r) => estimateAttacker(r));
  // Log-scaled memory bars so ~1 KB and 65,536 KB are both legible on one axis.
  const maxMemLog = Math.max(...results.map((r) => Math.log10(Math.max(r.memoryNominalKB, 1))), 1);

  const cards = results
    .map((r, i) => {
      const paramsStr = Object.entries(r.params)
        .map(([k, v]) => `${escapeHtml(String(k))}: ${escapeHtml(String(v))}`)
        .join(', ');
      const hexPreview = toHex(r.output).slice(0, 32) + '…';
      const note = r.note ? `<p class="note">${escapeHtml(r.note)}</p>` : '';
      const atk = attacks[i];
      const boundLabel = atk.boundedBy === 'memory' ? 'RAM-bound' : 'compute-bound';
      const isMemHard = r.memoryNominalKB > 16;

      return `
      <li class="result-card">
        <h3>${escapeHtml(r.kdf)}</h3>
        <p class="time">${r.timeMs.toFixed(1)}<span class="time-unit"> ms</span></p>
        <p class="params">${paramsStr}</p>
        <p class="memory">Nominal memory: ~${r.memoryNominalKB.toLocaleString()} KB <span class="memory-caveat" title="Algorithm-defined working-set size, not measured RAM. HKDF/PBKDF2 are compute-bound, so their footprint is tiny and approximate.">(defined, not measured)</span></p>
        ${isMemHard ? memoryFillGrid(r.memoryNominalKB) : ''}
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

  const memBars = results
    .map((r) => {
      const memKB = Math.max(r.memoryNominalKB, 1);
      const pct = (Math.log10(memKB) / maxMemLog) * 100;
      const labelId = `bar-m-${r.kdf.replace(/\W/g, '')}`;
      const human =
        memKB >= 1024 ? `${(memKB / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} MiB` : `~${memKB} KB`;
      const valueText = `${r.memoryNominalKB.toLocaleString()} kilobytes per guess`;
      return `
      <div class="bar-row">
        <span class="bar-label" id="${labelId}">${escapeHtml(r.kdf)}</span>
        <div class="bar-track" role="meter" aria-valuenow="${r.memoryNominalKB}" aria-valuemin="1" aria-valuemax="${Math.round(10 ** maxMemLog)}" aria-valuetext="${valueText}" aria-labelledby="${labelId}"><div class="bar-fill bar-fill-mem" style="width: ${pct.toFixed(1)}%"></div></div>
        <span class="bar-value" aria-hidden="true">${human}</span>
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
    <div class="charts">
      <div class="bar-chart">
        <h2>Defender cost: wall-clock time</h2>
        <p class="chart-caption">How long one derivation takes on this machine. Longer is safer — but only up to what your users will tolerate.</p>
        ${timeBars}
      </div>
      <div class="bar-chart">
        <h2>Attacker's per-guess memory cost <span class="chart-scale">(log scale)</span></h2>
        <p class="chart-caption">RAM each in-flight guess must hold. This is the memory-hardness axis that a timing-only chart hides — scrypt and Argon2id tower over PBKDF2/HKDF here.</p>
        ${memBars}
      </div>
    </div>`;
}

export function renderPlaceholder(): string {
  return `<div class="results-placeholder">Enter a password and click <strong>Run Benchmark</strong> to compare KDFs.</div>`;
}

export function renderRunning(): string {
  return `<div class="status" role="status"><span class="spinner" aria-hidden="true">&#9881;</span> Running benchmarks…</div>`;
}
