import './style.css';
import { runAll } from './bench.ts';
import { renderResults, renderPlaceholder, renderRunning } from './ui.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<a class="skip-link" href="#results">Skip to results</a>
<header>
  <h1>KDF Arena</h1>
  <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to light mode">
    <span class="theme-toggle-icon" aria-hidden="true">&#127769;</span>
  </button>
</header>
<main id="main">
  <form class="controls" id="bench-form">
    <div class="control-group">
      <label for="password-input">Password</label>
      <input id="password-input" type="text" autocomplete="off" autocapitalize="off"
             spellcheck="false" enterkeyhint="go" value="correct horse battery staple" />
    </div>
    <button class="run-btn" id="run-btn" type="submit">Run Benchmark</button>
  </form>
  <section class="results" id="results" aria-live="polite" aria-busy="false"
           tabindex="-1" aria-label="Benchmark results">${renderPlaceholder()}</section>
</main>
<footer>
  Part of <a href="https://systemslibrarian.github.io/crypto-lab/" rel="noopener">crypto-lab</a> ·
  <a href="https://github.com/systemslibrarian/crypto-lab-kdf-arena" rel="noopener">Source</a>
  <br />
  Related demos:
  <a href="https://systemslibrarian.github.io/crypto-lab-kdf-chain/" rel="noopener">crypto-lab-kdf-chain</a> ·
  <a href="https://systemslibrarian.github.io/crypto-lab-bcrypt-forge/" rel="noopener">crypto-lab-bcrypt-forge</a> ·
  <a href="https://systemslibrarian.github.io/crypto-lab-phantom-vault/" rel="noopener">crypto-lab-phantom-vault</a> ·
  <a href="https://systemslibrarian.github.io/crypto-lab-shadow-vault/" rel="noopener">crypto-lab-shadow-vault</a> ·
  <a href="https://systemslibrarian.github.io/crypto-lab-mac-race/" rel="noopener">crypto-lab-mac-race</a>
</footer>
`;

function setupThemeToggle(): void {
  const btn = document.getElementById('theme-toggle')!;
  const icon = btn.querySelector('.theme-toggle-icon')!;
  function sync(): void {
    const current = document.documentElement.getAttribute('data-theme') ?? 'dark';
    const isDark = current === 'dark';
    icon.textContent = isDark ? '\u{1F319}' : '\u{2600}\u{FE0F}';
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
  const form = document.getElementById('bench-form') as HTMLFormElement;
  const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
  const passwordInput = document.getElementById('password-input') as HTMLInputElement;
  const resultsDiv = document.getElementById('results')!;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = passwordInput.value;
    if (!password) {
      passwordInput.focus();
      return;
    }

    runBtn.disabled = true;
    resultsDiv.setAttribute('aria-busy', 'true');
    resultsDiv.innerHTML = renderRunning();

    try {
      const results = await runAll(password);
      resultsDiv.innerHTML = renderResults(results);
    } catch (err) {
      const safeMsg = (err instanceof Error ? err.message : String(err)).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      resultsDiv.innerHTML = `<div class="status status-error" role="alert">Error: ${safeMsg}</div>`;
    } finally {
      runBtn.disabled = false;
      resultsDiv.setAttribute('aria-busy', 'false');
    }
  });
}

setupThemeToggle();
setupBenchmark();
