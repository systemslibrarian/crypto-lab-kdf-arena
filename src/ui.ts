import type { BenchResult } from './bench.ts';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderResults(results: BenchResult[]): string {
  const maxTime = Math.max(...results.map((r) => r.timeMs));

  const cards = results
    .map((r) => {
      const paramsStr = Object.entries(r.params)
        .map(([k, v]) => `${escapeHtml(String(k))}: ${escapeHtml(String(v))}`)
        .join(', ');
      const hexPreview = toHex(r.output).slice(0, 32) + '\u2026';
      const note = r.note ? `<p class="note">${escapeHtml(r.note)}</p>` : '';

      return `
      <li class="result-card">
        <h3>${escapeHtml(r.kdf)}</h3>
        <p class="time">${r.timeMs.toFixed(1)}<span class="time-unit"> ms</span></p>
        <p class="params">${paramsStr}</p>
        <p class="memory">Memory: ~${r.memoryEstimateKB.toLocaleString()} KB</p>
        <p class="output-preview">Derived key: <code>${hexPreview}</code></p>
        ${note}
      </li>`;
    })
    .join('');

  const bars = results
    .map((r) => {
      const pct = maxTime > 0 ? (r.timeMs / maxTime) * 100 : 0;
      const labelId = `bar-${r.kdf.replace(/\W/g, '')}`;
      const valueText = `${r.timeMs.toFixed(1)} milliseconds`;
      return `
      <div class="bar-row">
        <span class="bar-label" id="${labelId}">${escapeHtml(r.kdf)}</span>
        <div class="bar-track" role="meter" aria-valuenow="${r.timeMs.toFixed(1)}" aria-valuemin="0" aria-valuemax="${maxTime.toFixed(1)}" aria-valuetext="${valueText}" aria-labelledby="${labelId}"><div class="bar-fill" style="width: ${pct.toFixed(1)}%"></div></div>
        <span class="bar-value" aria-hidden="true">${r.timeMs.toFixed(1)} ms</span>
      </div>`;
    })
    .join('');

  return `
    <h2 class="section-heading">Results</h2>
    <ul class="result-cards" role="list">${cards}</ul>
    <div class="bar-chart">
      <h2>Timing comparison</h2>
      ${bars}
    </div>`;
}

export function renderPlaceholder(): string {
  return `<div class="results-placeholder">Enter a password and click <strong>Run Benchmark</strong> to compare KDFs.</div>`;
}

export function renderRunning(): string {
  return `<div class="status" role="status"><span class="spinner" aria-hidden="true">&#9881;</span> Running benchmarks\u2026</div>`;
}
