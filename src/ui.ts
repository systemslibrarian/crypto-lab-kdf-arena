import type { BenchResult } from './bench.ts';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderResults(results: BenchResult[]): string {
  const maxTime = Math.max(...results.map((r) => r.timeMs));

  const cards = results
    .map((r) => {
      const paramsStr = Object.entries(r.params)
        .map(([k, v]) => `${escapeHtml(String(k))}: ${escapeHtml(String(v))}`)
        .join(', ');
      const hexPreview = toHex(r.output).slice(0, 32) + '\u2026';
      const note = r.note ? `<div class="note">${escapeHtml(r.note)}</div>` : '';

      return `
      <div class="result-card">
        <h3>${r.kdf}</h3>
        <div class="time">${r.timeMs.toFixed(1)}<span class="time-unit"> ms</span></div>
        <div class="params">${paramsStr}</div>
        <div class="memory">Memory: ~${r.memoryEstimateKB.toLocaleString()} KB</div>
        <div class="output-preview"><code>${hexPreview}</code></div>
        ${note}
      </div>`;
    })
    .join('');

  const bars = results
    .map((r) => {
      const pct = maxTime > 0 ? (r.timeMs / maxTime) * 100 : 0;
      return `
      <div class="bar-row">
        <span class="bar-label" id="bar-${r.kdf.replace(/\W/g, '')}">${escapeHtml(r.kdf)}</span>
        <div class="bar-track" role="meter" aria-valuenow="${r.timeMs.toFixed(1)}" aria-valuemin="0" aria-valuemax="${maxTime.toFixed(1)}" aria-labelledby="bar-${r.kdf.replace(/\W/g, '')}"><div class="bar-fill" style="width: ${pct.toFixed(1)}%"></div></div>
        <span class="bar-value">${r.timeMs.toFixed(1)} ms</span>
      </div>`;
    })
    .join('');

  return `
    <div class="result-cards">${cards}</div>
    <div class="bar-chart">
      <h2>Timing Comparison</h2>
      ${bars}
    </div>`;
}

export function renderPlaceholder(): string {
  return `<div class="results-placeholder">Enter a password and click <strong>Run Benchmark</strong> to compare KDFs.</div>`;
}

export function renderRunning(): string {
  return `<div class="status" role="status"><span class="spinner" aria-hidden="true">&#9881;</span> Running benchmarks\u2026</div>`;
}
