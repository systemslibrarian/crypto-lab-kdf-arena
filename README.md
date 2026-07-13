# crypto-lab-kdf-arena

## What It Is

KDF Arena is a live, in-browser benchmarking tool that compares four key derivation functions side-by-side: HKDF-SHA256, PBKDF2-SHA256, scrypt, and Argon2id. All four run in pure JavaScript via [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) — no WASM, no native bindings — and every one is checked against its RFC known-answer vector in the test suite (see **Accessibility & Testing**). It measures wall-clock derivation time and reports each function's *nominal* (algorithm-defined, not measured) memory cost using identical input (password + random 16-byte salt). HKDF is included for educational contrast — it is an extract-and-expand KDF for already-strong key material, not a password-hashing function. The three password KDFs (PBKDF2, scrypt, Argon2id) are compared at their recommended default parameters to illustrate the trade-off between iteration hardness and memory hardness, and each parameter is adjustable in the UI's **Cost parameters** panel.

> **A note on the memory figure.** The "nominal memory" shown per KDF is *defined, not measured*: for scrypt it is `128 * N * r` bytes and for Argon2id it is the `memory` parameter (both are the algorithms' actual working-set sizes), while for HKDF and PBKDF2 — which are compute-bound, not memory-hard — it is the small, roughly-constant scratch space they use. It is not a live RSS/heap measurement of the browser.

The live page opens with a plain-language framing of *what a KDF is* and *the compute-hard vs memory-hard tension* the arena teaches, so a first-time visitor gets the "why" without opening this README. Results are shown through a defender/attacker lens — alongside the wall-clock time, each KDF reports an order-of-magnitude **attacker guesses/sec** estimate (derived from that run's real time and the algorithm's defined memory cost) and whether it is compute- or RAM-bound. The memory-hardness axis is then made *visible*, not just tabulated: four same-size **memory-fill grids** sit in one row on a true linear scale, so PBKDF2/HKDF read as one lonely lit cell beside scrypt's and Argon2id's near-full grids; an interactive **RAM-wall** exhibit draws the attacker's fixed RAM pool and compute lanes and lets you drag Argon2id's memory parameter to watch idle cores get evicted in real time; and the per-guess-memory bar chart defaults to a **linear** scale (with a one-click switch to log) so the honest ~64,000× gap lands before it is compressed for legibility.

## Exhibits

1. **On-page framing block** — a college-level intro defining KDFs and the compute-hard (PBKDF2) vs memory-hard (scrypt, Argon2id) tension, calling out HKDF as the deliberately-included *wrong tool*.
2. **Four-KDF benchmark** — HKDF-SHA256, PBKDF2-SHA256, scrypt, and Argon2id derived in-browser from a shared salt at adjustable cost parameters, each verified against its RFC known-answer vector.
3. **Per-KDF mechanism schematics** — each result card carries a small annotated diagram of that KDF's inner loop: HKDF's two labelled *extract → expand* boxes (no cost knob), PBKDF2's single hash inside a repeat-counter loop, and scrypt/Argon2id's array of memory blocks written then re-read — turning "compute-hard = repeat a hash" vs "memory-hard = fill and revisit RAM" from prose into a picture.
4. **Memory-fill grids, drawn to scale** — all four KDFs shown as same-size cell grids in one row on a *true linear* scale (each measured against the hungriest KDF in the run), so the compute-hard pair light one lonely cell directly beside the near-full memory-hard grids. The side-by-side emptiness-vs-fullness is the demo's clearest single view of memory-hardness.
5. **RAM-wall attacker rig** — a fixed pool of RAM and compute lanes drawn as a token board; guesses that fit are lit and the RAM-starved remainder go idle. A live slider on Argon2id's memory parameter evicts lanes in real time, so *why* adding cores stops helping once you are RAM-bound is watched, not asserted.
6. **Dual charts with a linear/log toggle** — wall-clock *defender cost* beside *attacker's per-guess memory cost*; the memory chart defaults to **linear** (the honest ratio) with a one-click switch to **log** (legible but flattening), each explained in a caption, so a learner cannot mistake Argon2id for "just a slower PBKDF2".
7. **Attacker-lens estimate** — a live, clearly-labelled order-of-magnitude guesses/sec figure per KDF plus its dominating bottleneck (compute vs memory), updating as the cost knobs change.
8. **One-click "weaken it" presets** — a guided toggle per password KDF (PBKDF2 → 1,000 iterations; Argon2id → 8 MiB) alongside the manual number fields, so newcomers who don't know good parameter ranges can flip a strong default to a deliberately weak one and re-run to see the attacker's guesses/sec jump.
9. **Salt-uniqueness lesson** — an on-page callout explaining why the derived key changes each run, with a *Reuse salt across runs* toggle that reproduces identical keys to demonstrate the rainbow-table failure mode.
10. **Jargon glossary** — collapsible in-page definitions for extract-and-expand, iterations/compute-hardness, memory-hardness, lanes/parallelism, and KiB.

## When to Use It

- **Choosing a password KDF for a new system** — run the benchmark on target hardware to see real timing costs before committing to PBKDF2, scrypt, or Argon2id.
- **Tuning cost parameters** — open the **Cost parameters** panel to adjust iterations (PBKDF2), N/r/p (scrypt), or time/memory/parallelism (Argon2id) and observe the impact on derivation time. The derived keys change as you lower the cost, making it concrete that a weaker parameter is a different (and easier-to-crack) function.
- **Teaching the difference between HKDF and password KDFs** — the sub-millisecond HKDF result makes it visually obvious that HKDF is not designed to resist brute-force attacks on passwords.
- Do NOT use these results as a server-side benchmark — single-threaded JavaScript in a browser does not represent native C/Rust implementations on a server.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-kdf-arena](https://systemslibrarian.github.io/crypto-lab-kdf-arena/)**

Enter any password string and click **Run Benchmark** to derive 32-byte keys with all four KDFs using a shared random salt. The results panel shows wall-clock time in milliseconds, the nominal (defined, not measured) memory cost, an order-of-magnitude attacker guesses/sec estimate, a per-KDF inner-loop schematic, and a hex preview of each derived key. Below the cards, four same-size **memory-fill grids** put every KDF on one true linear scale, an interactive **RAM-wall** exhibit lets you drag Argon2id's memory to evict attacker lanes live, and two bar charts compare defender time and attacker per-guess memory cost — the memory chart defaulting to linear with a one-click switch to log. Use the per-KDF **Weaken** presets or expand **Cost parameters** to tune the cost knobs, and toggle **Reuse salt across runs** to see identical passwords derive identical keys.

## What Can Go Wrong

- **PBKDF2 iteration count too low** — using fewer than 600,000 SHA-256 iterations (NIST SP 800-132 2023 guidance) makes offline brute-force feasible on modern GPUs.
- **scrypt N parameter too small** — if `128 * N * r` fits comfortably in GPU memory, scrypt loses its memory-hardness advantage over PBKDF2.
- **Argon2id memory set below 64 MB** — reducing the `memory` parameter shrinks the cost asymmetry between defender and attacker; OWASP recommends at least 64 MB for interactive logins.
- **Using HKDF to hash passwords** — HKDF has no cost parameter and completes in microseconds, offering zero brute-force resistance.
- **Salt reuse across users** — all four KDFs require a unique random salt per credential; reusing a salt enables precomputation (rainbow-table) attacks.

## Real-World Usage

- **Argon2id** — default password hash in the libsodium `crypto_pwhash` API, adopted by 1Password, Bitwarden, and the PHC (Password Hashing Competition) winner.
- **scrypt** — used by Tarsnap for key derivation and by Litecoin's proof-of-work algorithm; recommended in RFC 7914.
- **PBKDF2-SHA256** — required by WPA2 for Wi-Fi key derivation, used in LUKS disk encryption, and specified in NIST SP 800-132.
- **HKDF-SHA256** — used by TLS 1.3 (RFC 8446) for deriving traffic keys from the handshake secret, and by the Signal Protocol for ratchet key derivation.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-kdf-arena
cd crypto-lab-kdf-arena
npm install
npm run dev
```

## Related Demos

- [crypto-lab-kdf-chain](https://systemslibrarian.github.io/crypto-lab-kdf-chain/) — sibling KDF demo with a decision tree, derivation chains, and an attacker-cost model.
- [crypto-lab-bcrypt-forge](https://systemslibrarian.github.io/crypto-lab-bcrypt-forge/) — bcrypt cost-factor tuning, the other major password-hashing family.
- [crypto-lab-phantom-vault](https://systemslibrarian.github.io/crypto-lab-phantom-vault/) — PBKDF2-SHA-256 key stretching with HMAC-DRBG in a vault context.
- [crypto-lab-shadow-vault](https://systemslibrarian.github.io/crypto-lab-shadow-vault/) — Argon2id plus ChaCha20-Poly1305 for file encryption.
- [crypto-lab-mac-race](https://systemslibrarian.github.io/crypto-lab-mac-race/) — HMAC and other MACs, the PRF underneath these KDFs.

## Accessibility & Testing

**Crypto correctness.** `npm test` runs a [Vitest](https://vitest.dev) suite
(`test/kdf.test.ts`) that recomputes the published RFC known-answer vectors —
HKDF-SHA256 (RFC 5869), PBKDF2-HMAC-SHA256 (RFC 7914 §10), scrypt (RFC 7914
§12), and Argon2id (RFC 9106 §5.3) — through the *same* functions the UI calls
in `src/bench.ts`, plus determinism, parameter-liveness, and salt-uniqueness
property tests. A regression that swapped an algorithm, dropped a parameter, or
truncated an output would fail here rather than ship.

KDF Arena is also built to a WCAG 2.1 AA standard and verified by an automated
audit harness (`audit/run.mjs`) that drives the real page in Chromium:

- **axe-core** (WCAG 2.0/2.1 A + AA) on desktop *and* mobile viewports, in both
  the initial and post-benchmark states — **0 violations**.
- **Lighthouse** (mobile form factor) — **100 accessibility, 100 best-practices,
  100 SEO, 100 performance**.
- A **screen-reader accessibility-tree check** asserting the heading outline,
  landmark/region names, labelled controls, the skip link, and the named timing
  meters.

Highlights: logical heading order, a skip link, a real `<form>` (Enter runs the
benchmark), an `aria-live` results region with `aria-busy`, 44px touch targets, a
16px input floor to prevent iOS zoom, system-preference theme detection,
`prefers-reduced-motion` support, and AA-compliant contrast in both themes.

```sh
npm install
npm test                          # RFC known-answer + property tests (Vitest)
npx playwright install chromium   # one-time, for the a11y gate / audit
npm run test:a11y                 # WCAG A/AA gate (axe-core, both themes)
npm run audit                     # build + axe + Lighthouse + SR-tree checks
```

---

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
