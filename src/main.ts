import './style.css';
import { runAll, type RunOptions } from './bench.ts';
import { renderResults, renderPlaceholder, renderRunning } from './ui.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<main id="main">
  <!-- Skip link and title header live inside <main>: the shared crypto-lab
       topbar is the page's single banner landmark, so the page header must not
       be a second banner, and all content (skip link included) must sit inside
       a landmark (axe landmark-no-duplicate-banner / region). -->
  <a class="skip-link" href="#results">Skip to results</a>
  <header>
    <h1>KDF Arena</h1>
    <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to light mode">
      <span class="theme-toggle-icon" aria-hidden="true">&#127769;</span>
    </button>
  </header>
  <section class="intro" aria-label="What this demo teaches">
    <p class="intro-lead">
      A <dfn>key derivation function (KDF)</dfn> turns a password (or other secret)
      into cryptographic key material. This arena races four of them so you can
      <em>feel</em> the core tension in password hashing: making each guess
      expensive for an attacker without making login painful for the user.
    </p>
    <p>
      There are two ways to make a guess expensive.
      <strong>PBKDF2</strong> is <dfn>compute-hard</dfn> — it just repeats a hash
      hundreds of thousands of times, which a GPU parallelises cheaply.
      <strong>scrypt</strong> and <strong>Argon2id</strong> are
      <dfn>memory-hard</dfn> — each guess must fill a large block of RAM, and RAM
      is the one thing an attacker's thousands of parallel cores cannot share.
      <strong>HKDF</strong> is the odd one out: it is deliberately included as the
      <em>wrong tool</em>. It is fast by design because it expands
      <em>already-strong</em> key material and was never meant to slow down a
      password guesser — watch it finish in microseconds and offer zero
      resistance.
    </p>
    <details class="glossary" id="glossary">
      <summary>Jargon glossary — tap any term</summary>
      <dl class="glossary-list">
        <dt>extract-and-expand</dt>
        <dd>HKDF's two-step design: first <em>extract</em> a uniform key from
          messy input entropy, then <em>expand</em> it to as many output bytes as
          you need. Great for splitting one strong secret into many keys; useless
          as a password slow-down (there is no cost knob).</dd>
        <dt>iterations (compute-hardness)</dt>
        <dd>How many times PBKDF2 repeats its inner hash. More iterations = more
          CPU per guess, for defender and attacker alike. The only lever PBKDF2
          has.</dd>
        <dt>memory-hardness</dt>
        <dd>A guess is forced to allocate and touch a large working set of memory.
          Attackers who scale by adding compute cores hit a RAM wall instead — the
          defining property of scrypt and Argon2id.</dd>
        <dt>lanes / parallelism (p)</dt>
        <dd>How many independent threads an Argon2id/scrypt computation splits
          into. Tunes how the memory-hard work maps onto multi-core hardware.</dd>
        <dt>KiB</dt>
        <dd>Kibibyte = 1024 bytes (binary), distinct from a kB = 1000 bytes.
          Argon2id's memory parameter is counted in KiB; 65,536 KiB = 64 MiB.</dd>
      </dl>
    </details>
  </section>
  <form class="controls" id="bench-form">
    <div class="control-group">
      <label for="password-input">Password</label>
      <input id="password-input" type="text" autocomplete="off" autocapitalize="off"
             spellcheck="false" enterkeyhint="go" value="correct horse battery staple" />
    </div>
    <button class="run-btn" id="run-btn" type="submit">Run Benchmark</button>
    <div class="control-group control-group-check">
      <label class="check-label" for="reuse-salt">
        <input id="reuse-salt" name="reuse-salt" type="checkbox" />
        <span>Reuse salt across runs</span>
      </label>
      <span class="check-hint" id="reuse-salt-hint">
        Off: fresh random salt each run (correct). On: pin one salt to see
        identical passwords derive identical keys.
      </span>
    </div>
    <details class="params-advanced" id="params-advanced">
      <summary>Cost parameters</summary>
      <p class="params-hint">
        Defaults follow current guidance (NIST SP 800-132, RFC 7914, OWASP).
        Lower them to see how derivation time collapses — and with it,
        brute-force resistance.
      </p>
      <fieldset class="param-set">
        <legend>PBKDF2-SHA256</legend>
        <div class="control-group control-group-num">
          <label for="pbkdf2-iterations">Iterations</label>
          <input id="pbkdf2-iterations" name="pbkdf2-iterations" type="number"
                 inputmode="numeric" min="1" max="10000000" step="1" value="600000" />
        </div>
      </fieldset>
      <fieldset class="param-set">
        <legend>scrypt</legend>
        <div class="control-group control-group-num">
          <label for="scrypt-n">N (cost, power of 2)</label>
          <input id="scrypt-n" name="scrypt-n" type="number" inputmode="numeric"
                 min="2" max="4194304" step="1" value="131072" />
        </div>
        <div class="control-group control-group-num">
          <label for="scrypt-r">r (block size)</label>
          <input id="scrypt-r" name="scrypt-r" type="number" inputmode="numeric"
                 min="1" max="64" step="1" value="8" />
        </div>
        <div class="control-group control-group-num">
          <label for="scrypt-p">p (parallelism)</label>
          <input id="scrypt-p" name="scrypt-p" type="number" inputmode="numeric"
                 min="1" max="16" step="1" value="1" />
        </div>
      </fieldset>
      <fieldset class="param-set">
        <legend>Argon2id</legend>
        <div class="control-group control-group-num">
          <label for="argon2-time">Time (passes)</label>
          <input id="argon2-time" name="argon2-time" type="number" inputmode="numeric"
                 min="1" max="20" step="1" value="3" />
        </div>
        <div class="control-group control-group-num">
          <label for="argon2-memory">Memory (KiB)</label>
          <input id="argon2-memory" name="argon2-memory" type="number" inputmode="numeric"
                 min="8" max="1048576" step="8" value="65536" />
        </div>
        <div class="control-group control-group-num">
          <label for="argon2-parallelism">Parallelism (lanes)</label>
          <input id="argon2-parallelism" name="argon2-parallelism" type="number" inputmode="numeric"
                 min="1" max="16" step="1" value="4" />
        </div>
      </fieldset>
    </details>
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

  // Read a positive integer from a number input, falling back to its default
  // (`value` attribute) when the field is blank or invalid.
  function intFrom(id: string): number {
    const el = document.getElementById(id) as HTMLInputElement | null;
    const raw = Number(el?.value);
    const fallback = Number(el?.defaultValue) || 0;
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  }

  // A single pinned salt for the "reuse salt" teaching mode. Generated once and
  // reused for every run while the toggle stays checked, so identical inputs
  // reproduce identical keys — the visible symptom of the rainbow-table failure.
  const pinnedSalt = crypto.getRandomValues(new Uint8Array(16));

  function readOptions(): RunOptions {
    const reuse = (document.getElementById('reuse-salt') as HTMLInputElement | null)?.checked;
    return {
      pbkdf2Iterations: intFrom('pbkdf2-iterations'),
      scryptN: intFrom('scrypt-n'),
      scryptR: intFrom('scrypt-r'),
      scryptP: intFrom('scrypt-p'),
      argon2Time: intFrom('argon2-time'),
      argon2Memory: intFrom('argon2-memory'),
      argon2Parallelism: intFrom('argon2-parallelism'),
      fixedSalt: reuse ? pinnedSalt : undefined,
    };
  }

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
      const opts = readOptions();
      const { results, salt } = await runAll(password, opts);
      resultsDiv.innerHTML = renderResults(results, {
        saltReused: !!opts.fixedSalt,
        salt,
      });
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
