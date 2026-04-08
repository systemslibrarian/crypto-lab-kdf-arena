import './style.css';
import { runAll } from './bench.ts';
import { renderResults, renderPlaceholder, renderRunning } from './ui.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header>
  <h1>KDF Arena</h1>
  <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to light mode">&#127769;</button>
</header>
<main>
  <div class="controls">
    <div class="control-group">
      <label for="password-input">Password</label>
      <input id="password-input" type="text" autocomplete="off" value="correct horse battery staple" />
    </div>
    <button class="run-btn" id="run-btn" type="button">Run Benchmark</button>
  </div>
  <div class="results" id="results" aria-live="polite">${renderPlaceholder()}</div>
</main>
<footer>
  Part of <a href="https://systemslibrarian.github.io/crypto-lab/" rel="noopener">crypto-lab</a> ·
  <a href="https://github.com/systemslibrarian/crypto-lab-kdf-arena" rel="noopener">Source</a>
</footer>
`;

function setupThemeToggle(): void {
  const btn = document.getElementById('theme-toggle')!;
  function sync(): void {
    const current = document.documentElement.getAttribute('data-theme') ?? 'dark';
    const isDark = current === 'dark';
    btn.textContent = isDark ? '\u{1F319}' : '\u{2600}\u{FE0F}';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  }
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') ?? 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    sync();
  });
  sync();
}

function setupBenchmark(): void {
  const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
  const passwordInput = document.getElementById('password-input') as HTMLInputElement;
  const resultsDiv = document.getElementById('results')!;

  runBtn.addEventListener('click', async () => {
    const password = passwordInput.value;
    if (!password) return;

    runBtn.disabled = true;
    resultsDiv.innerHTML = renderRunning();

    try {
      const results = await runAll(password);
      resultsDiv.innerHTML = renderResults(results);
    } catch (err) {
      const safeMsg = (err instanceof Error ? err.message : String(err)).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      resultsDiv.innerHTML = `<div class="status status-error" role="alert">Error: ${safeMsg}</div>`;
    } finally {
      runBtn.disabled = false;
    }
  });
}

setupThemeToggle();
setupBenchmark();
