import { RECORD_DEMO, SYNTHETIC_DICTIONARY, runRecordExercise, type RecordTrial } from './record-design.ts';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const LABELS = {
  'kdf-only': 'F(p)',
  'plaintext-tail': 'F(p) || p',
  'cheap-hash-tail': 'F(p) || H(p)',
} as const;

export function renderRecordWorkshop(): string {
  return `
    <section class="record-workshop" id="record-design" aria-labelledby="record-heading">
      <h2 id="record-heading">Does expensive computation protect the whole record?</h2>
      <p>Creating all three records below really runs scrypt. Two invented designs still
        reveal the password cheaply because of what they append to its output.
        Compare the defender’s work with the steps an attacker actually takes.</p>
      <p><strong>Fixed synthetic exercise:</strong> choose one of six public demo strings.
        The attacker receives the record and tries this dictionary in its listed order,
        stopping at the first match. This exercise is separate from the benchmark password.</p>
      <p><code>F(p)</code> is scrypt with N=${RECORD_DEMO.N}, r=${RECORD_DEMO.r}, p=${RECORD_DEMO.p},
        a 32-byte output and public salt <code>${RECORD_DEMO.salt}</code>.
        Its nominal main working set is 1 MiB. <code>H(p)</code> is one SHA-256 of the UTF-8 password.
        These deliberately small costs and the shared demo salt are for this comparison,
        not production settings. <code>||</code> means appending a separate readable field.</p>
      <form class="controls" id="record-form">
        <div class="control-group">
          <label for="record-password">Synthetic password</label>
          <select id="record-password" name="record-password">${SYNTHETIC_DICTIONARY.map((password, index) =>
            `<option value="${index}"${index === 2 ? ' selected' : ''}>${index + 1}. ${password}</option>`).join('')}</select>
        </div>
        <button type="submit" class="run-btn" id="record-run">Compare record designs</button>
      </form>
      <div id="record-results" aria-live="polite" aria-busy="false">
        <p>Predict which records require scrypt during recovery, then run the comparison.</p>
      </div>
      <p class="record-boundary"><strong>What this proves:</strong> an expensive output computation
        does not by itself establish password unrecoverability. The leaking fields bypass it.
        These are deliberately bad invented records, not attacks on standard scrypt or Argon2
        password storage. Counts show the displayed strategy on six known strings, not a lower
        bound on all attackers, real-world crack times, or the paper’s multi-instance theorem.</p>
      <p class="record-source">Reading: Dodd, Farshim, Shahandashti and Southern,
        <a href="https://pure.york.ac.uk/portal/en/publications/multi-instance-unrecoverability-of-imhf-based-password-hashing/">Multi-Instance Unrecoverability of iMHF-Based Password Hashing</a>
        (<a href="https://eprint.iacr.org/2026/018">ePrint 2026/018</a>).
        This exercise illustrates its motivation; it does not implement its formal bounds.</p>
    </section>`;
}

export function renderRecordTrials(trials: RecordTrial[]): string {
  const rows = trials.map(({ record, creation, recovery }) => `
    <tr data-record="${record.kind}">
      <th scope="row"><code>${LABELS[record.kind]}</code></th>
      <td data-count="create-f">${creation.fCalls}</td>
      <td data-count="create-h">${creation.hCalls}</td>
      <td data-count="recover-f">${recovery.counts.fCalls}</td>
      <td data-count="recover-h">${recovery.counts.hCalls}</td>
      <td data-count="comparisons">${recovery.counts.comparisons}</td>
      <td data-count="reads">${recovery.counts.disclosedReads}</td>
      <td class="record-recovered"><code>${escapeHtml(recovery.recovered ?? 'No match')}</code></td>
    </tr>`).join('');
  const traces = trials.map(({ record, recovery }) => {
    const explanation = record.kind === 'kdf-only'
      ? 'The displayed dictionary strategy evaluates F for each candidate it compares. This is not a proof that no better attack exists.'
      : record.kind === 'plaintext-tail'
        ? 'Read the appended password directly: no guessing, hashing or expensive verification is needed.'
        : 'Compare cheap SHA-256 values; reject wrong candidates without scrypt. The match identifies the chosen entry within this fixed dictionary. No scrypt verification is performed.';
    const extra = record.kind === 'plaintext-tail' ? ` || ${record.plaintext}`
      : record.kind === 'cheap-hash-tail' ? ` || ${record.cheapHash}` : '';
    return `
      <details class="record-trace" data-trace="${record.kind}">
        <summary>${LABELS[record.kind]} — inspect stored fields and recovery steps</summary>
        <p>${explanation}</p>
        <p class="record-bytes">Stored fields: <code>${escapeHtml(record.expensive + extra)}</code></p>
        <ol>${recovery.steps.map((step) => `<li><code>${escapeHtml(step.candidate)}</code>:
          ${step.method === 'read' ? 'read the disclosed field (no candidate test)' : `${step.method} evaluation + comparison: ${step.matched ? 'match; stop' : 'reject'}`}</li>`).join('')}</ol>
      </details>`;
  }).join('');
  return `
    <p class="record-complete"><strong>Comparison complete.</strong> Every record incurred one real scrypt call at creation.
      The two leaking designs needed none during recovery.</p>
    <div class="record-table-scroll" tabindex="0" role="region" aria-label="Record operation counts, scroll horizontally on small screens">
      <table class="record-table">
        <caption>Actual calls and comparisons in this run (not timing estimates)</caption>
        <thead><tr><th scope="col">Stored record</th><th scope="col">Creation F</th><th scope="col">Creation H</th>
          <th scope="col">Recovery F</th><th scope="col">Recovery H</th><th scope="col">Candidate comparisons</th>
          <th scope="col">Direct reads</th><th scope="col">Recovered demo string</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p>F counts complete scrypt derivations; H counts standalone SHA-256 calls, excluding hashes inside scrypt.
      A candidate comparison checks an entire computed digest against the stored field. Direct reads need no comparison.
      There is one matched candidate in each hashing trace. The counts do not measure RAM or elapsed time.</p>
    ${traces}`;
}

export function wireRecordWorkshop(root: ParentNode = document): void {
  const form = root.querySelector<HTMLFormElement>('#record-form');
  const select = root.querySelector<HTMLSelectElement>('#record-password');
  const button = root.querySelector<HTMLButtonElement>('#record-run');
  const results = root.querySelector<HTMLElement>('#record-results');
  if (!form || !select || !button || !results) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const index = Number(select.value);
    button.disabled = true;
    select.disabled = true;
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<p role="status">Computing three synthetic records and comparing recovery steps…</p>';
    try {
      results.innerHTML = renderRecordTrials(await runRecordExercise(index));
    } catch (error) {
      results.innerHTML = `<p role="alert">Could not complete the comparison: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    } finally {
      results.setAttribute('aria-busy', 'false');
      button.disabled = false;
      select.disabled = false;
    }
  });
  select.addEventListener('change', () => {
    results.innerHTML = '<p>Selection changed. Run the comparison to compute results for this demo string.</p>';
  });
}
