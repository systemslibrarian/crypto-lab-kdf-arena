# crypto-lab-kdf-arena

## What It Is

KDF Arena is a live, in-browser benchmarking tool that compares four key derivation functions side-by-side: HKDF-SHA256, PBKDF2-SHA256, scrypt, and Argon2id. All four run in pure JavaScript via [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) — no WASM, no native bindings — and every one is pinned to its RFC known-answer vector in the test suite (see **Accessibility & Testing**). It measures wall-clock derivation time and reports each function's *nominal* (algorithm-defined, not measured) memory cost using identical input (password + random 16-byte salt). HKDF is included for educational contrast — it is an extract-and-expand KDF for already-strong key material, not a password-hashing function. The three password KDFs (PBKDF2, scrypt, Argon2id) are compared at their recommended default parameters to illustrate the trade-off between iteration hardness and memory hardness, and each parameter is adjustable in the UI's **Cost parameters** panel.

> **A note on the memory figure.** The "nominal memory" shown per KDF is *defined, not measured*: for scrypt it is `128 * N * r` bytes and for Argon2id it is the `memory` parameter (both are the algorithms' actual working-set sizes), while for HKDF and PBKDF2 — which are compute-bound, not memory-hard — it is the small, roughly-constant scratch space they use. It is not a live RSS/heap measurement of the browser.

The live page opens with a plain-language framing of *what a KDF is* and *the compute-hard vs memory-hard tension* the arena teaches, so a first-time visitor gets the "why" without opening this README. Results are shown through a defender/attacker lens — alongside the wall-clock time, each KDF reports an order-of-magnitude **attacker guesses/sec** estimate (derived from that run's real time and the algorithm's defined memory cost) and whether it is compute- or RAM-bound. The memory-hardness axis is then made *visible*, not just tabulated: four same-size **memory-fill grids** sit in one row on a true linear scale, so PBKDF2/HKDF read as one lonely lit cell beside the memory-hard grids (at the shipped defaults scrypt's 128 MiB fills its grid and Argon2id's 64 MiB fills half of it); an interactive **RAM-wall** exhibit draws the attacker's fixed RAM pool and compute lanes and lets you drag Argon2id's memory parameter to watch idle cores get evicted in real time; and the per-guess-memory bar chart defaults to a **linear** scale (with a one-click switch to log) so the honest gap lands before it is compressed for legibility. Every ratio the captions quote is computed from the run on screen — at the shipped defaults it is ~130,000×, and it restates itself when you move a cost knob.

## Exhibits

1. **On-page framing block** — a college-level intro defining KDFs and the compute-hard (PBKDF2) vs memory-hard (scrypt, Argon2id) tension, calling out HKDF as the deliberately-included *wrong tool*.
2. **Four-KDF benchmark** — HKDF-SHA256, PBKDF2-SHA256, scrypt, and Argon2id derived in-browser from a shared salt at adjustable cost parameters, PBKDF2 and scrypt are pinned to their RFC known-answer vectors through the exact `src/bench.ts` wrappers the UI calls; HKDF and Argon2id, whose vectors need inputs the wrappers do not expose, are pinned at the primitive (see **Accessibility & Testing**).
3. **Per-KDF mechanism schematics** — each result card carries a small annotated diagram of that KDF's inner loop: HKDF's two labelled *extract → expand* boxes (no cost knob), PBKDF2's single hash inside a repeat-counter loop, and scrypt/Argon2id's array of memory blocks written then re-read — turning "compute-hard = repeat a hash" vs "memory-hard = fill and revisit RAM" from prose into a picture.
4. **Memory-fill grids, drawn to scale** — all four KDFs shown as same-size cell grids in one row on a *true linear* scale (each measured against the hungriest KDF in the run), so the compute-hard pair light one lonely cell directly beside the far fuller memory-hard grids. The caption under the row names the hungriest KDF and the exact ratio for that run, so lowering a cost parameter restates the gap rather than leaving a stale figure on screen. The side-by-side emptiness-vs-fullness is the demo's clearest single view of memory-hardness.
5. **RAM-wall attacker rig** — a fixed pool of RAM and compute lanes drawn as a token board; guesses that fit are lit and the RAM-starved remainder go idle. A live slider on Argon2id's memory parameter evicts lanes in real time, so *why* adding cores stops helping once you are RAM-bound is watched, not asserted.
6. **Dual charts with a linear/log toggle** — wall-clock *defender cost* beside *attacker's per-guess memory cost*; the memory chart defaults to **linear** (the honest ratio) with a one-click switch to **log** (legible but flattening), each explained in a caption, so a learner cannot mistake Argon2id for "just a slower PBKDF2".
7. **Attacker-lens estimate** — a live, clearly-labelled order-of-magnitude guesses/sec figure per KDF plus its dominating bottleneck (compute vs memory), updating as the cost knobs change.
8. **One-click "weaken it" presets** — a guided toggle per password KDF (PBKDF2 → 1,000 iterations; Argon2id → 8 MiB) alongside the manual number fields, so newcomers who don't know good parameter ranges can flip a strong default to a deliberately weak one and re-run to see the attacker's guesses/sec jump.
9. **Salt-uniqueness lesson** — an on-page callout explaining why the derived key changes each run, with a *Reuse salt across runs* toggle that reproduces identical keys to demonstrate the rainbow-table failure mode.
10. **Jargon glossary** — collapsible in-page definitions for extract-and-expand, iterations/compute-hardness, memory-hardness, lanes/parallelism, and KiB.
11. **Whole-record recovery exercise** — compare `F(p)`, the deliberately leaking `F(p) || p`, and `F(p) || H(p)` using six fixed synthetic strings. All three records really compute scrypt at creation. Recovery of the leaking records reads the password or tests cheap SHA-256 values without calling scrypt. Exact operation counts and expandable traces expose the difference between expensive creation and password protection.

## Expensive Computation and the Complete Record

Open the [record-design exercise](https://systemslibrarian.github.io/crypto-lab-kdf-arena/#record-design), choose a synthetic string, and click **Compare record designs**. The selection is separate from the benchmark password field; there is no free-form input or uploaded dictionary in this exercise.

Here `F` is the existing scrypt wrapper with fixed `N=1024, r=8, p=1`, a 32-byte output, and public demo salt `kdf-record-demo!`. Its nominal main working set is 1 MiB. `H` is SHA-256 of the UTF-8 password. These small costs and the shared demo salt keep the comparison bounded and reproducible; they are not production settings. At most nine scrypt calls run per comparison: three independent record creations and up to six dictionary guesses for the `F(p)` record.

| Stored record | Creation | Displayed recovery strategy |
| --- | --- | --- |
| `F(p)` | One real scrypt call | Evaluate scrypt for each dictionary candidate until its full digest matches. |
| `F(p) || p` | One real scrypt call | Read the appended password; no candidate comparisons or scrypt calls. |
| `F(p) || H(p)` | One real scrypt call and one SHA-256 call | Compare candidate SHA-256 values; no scrypt calls or expensive verification. |

The table counts calls actually executed, candidate comparisons and direct reads. `H` counts standalone SHA-256 calls, excluding hashes internal to scrypt. The six candidates have distinct SHA-256 values, so a matching cheap digest identifies the selected entry within this dictionary. The UI clears old results when the selection changes. It makes no wall-clock attack-rate claim.

The exercise illustrates the distinction motivating Charles Dodd, Pooya Farshim, Siamak F. Shahandashti and Karl Southern, **Multi-Instance Unrecoverability of iMHF-Based Password Hashing** ([University of York research record](https://pure.york.ac.uk/portal/en/publications/multi-instance-unrecoverability-of-imhf-based-password-hashing/), [ePrint 2026/018](https://eprint.iacr.org/2026/018); recommendation CL2864): evaluation hardness alone does not establish password unrecoverability when a construction leaks information about its input. These are invented counterexamples, not attacks on standard scrypt or Argon2 password storage. This is a single-record teaching exercise, not an implementation or independent validation of the paper's multi-instance bounds.

The arena's RAM-wall estimate assumes full evaluations with the nominal working set. It does not cover time–memory trade-offs, preprocessing, hardware-specific attacks or shortcuts exposed by the complete record; it is not a lower bound on every attack. Those limits apply even when a derivation is genuinely expensive on the current browser.

## When to Use It

- **Choosing a password KDF for a new system** — run the benchmark on target hardware to see real timing costs before committing to PBKDF2, scrypt, or Argon2id.
- **Tuning cost parameters** — open the **Cost parameters** panel to adjust iterations (PBKDF2), N/r/p (scrypt), or time/memory/parallelism (Argon2id) and observe the impact on derivation time. The derived keys change as you lower the cost, making it concrete that a weaker parameter is a different (and easier-to-crack) function.
- **Teaching the difference between HKDF and password KDFs** — the sub-millisecond HKDF result makes it visually obvious that HKDF is not designed to resist brute-force attacks on passwords.
- Do NOT use these results as a server-side benchmark — single-threaded JavaScript in a browser does not represent native C/Rust implementations on a server.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-kdf-arena](https://systemslibrarian.github.io/crypto-lab-kdf-arena/)**

Enter any password string and click **Run Benchmark** to derive 32-byte keys with all four KDFs using a shared random salt. The results panel shows wall-clock time in milliseconds, the nominal (defined, not measured) memory cost, an order-of-magnitude attacker guesses/sec estimate, a per-KDF inner-loop schematic, and a hex preview of each derived key. Below the cards, four same-size **memory-fill grids** put every KDF on one true linear scale, an interactive **RAM-wall** exhibit lets you drag Argon2id's memory to evict attacker lanes live, and two bar charts compare defender time and attacker per-guess memory cost — the memory chart defaulting to linear with a one-click switch to log. Use the per-KDF **Weaken** presets or expand **Cost parameters** to tune the cost knobs, and toggle **Reuse salt across runs** to see identical passwords derive identical keys.

## What Can Go Wrong

- **PBKDF2 iteration count too low** — using fewer than 600,000 SHA-256 iterations (OWASP Password Storage Cheat Sheet; NIST SP 800-132 only sets a floor of 1,000) makes offline brute-force feasible on modern GPUs.
- **scrypt N parameter too small** — if `128 * N * r` fits comfortably in GPU memory, scrypt loses its memory-hardness advantage over PBKDF2.
- **Argon2id memory set too low** — reducing the `memory` parameter shrinks the cost asymmetry between defender and attacker. RFC 9106's second recommended option is 64 MiB; OWASP's stated minimum for interactive logins is 19 MiB (m=19456, t=2, p=1).
- **Using HKDF to hash passwords** — HKDF has no cost parameter and completes in microseconds, offering zero brute-force resistance.
- **Salt reuse across users** — all four KDFs require a unique random salt per credential; reusing a salt enables precomputation (rainbow-table) attacks.

## Real-World Usage

- **Argon2id** — winner of the Password Hashing Competition (2015), the default password hash in the libsodium `crypto_pwhash` API, and a selectable KDF in Bitwarden.
- **scrypt** — used by Tarsnap for key derivation and by Litecoin's proof-of-work algorithm; recommended in RFC 7914.
- **PBKDF2** — used for Wi-Fi key derivation in WPA2 (PBKDF2-HMAC-SHA1, 4096 iterations), in LUKS disk encryption, and specified in NIST SP 800-132.
- **HKDF-SHA256** — used by TLS 1.3 (RFC 9846) for deriving traffic keys from the handshake secret, and by the Signal Protocol for ratchet key derivation.

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
HKDF-SHA256 (RFC 5869), PBKDF2-HMAC-SHA256 (RFC 7914 §11), scrypt (RFC 7914
§12), and Argon2id (RFC 9106 §5.3) — plus determinism, parameter-liveness, and
salt-uniqueness property tests. A regression that swapped an algorithm, dropped
a parameter, or truncated an output would fail here rather than ship.

`test/record-design.test.ts` independently checks the exercise's scrypt and
SHA-256 fields, exact creation/recovery operation counts, first/middle/last
dictionary matches, early stopping, no-match exhaustion and bounded selection.
It also corrupts the expensive field to prove that the two leaking designs
really bypass it. `e2e/record-design.spec.ts` checks the displayed counts,
independence from the benchmark input, selection changes, expanded recovery
traces and narrow-screen accessibility in both themes.

Two of those vectors run through the exact `src/bench.ts` wrappers the UI calls:
`runPBKDF2` reproduces the RFC 7914 §11 vector and `runScrypt` the §12 one, so
those code paths are verified end to end. The HKDF and Argon2id vectors cannot
be: `runHKDF` pins its own `info` string, and `runArgon2id` exposes no secret
key or associated data, both of which the published vectors require. Those two
are pinned at the primitive, and the wrappers are separately asserted to agree
byte-for-byte with a direct `@noble/hashes` call at the same parameters — so a
swapped algorithm or dropped parameter still fails, just in two steps rather
than one.

**Page claims.** `e2e/claims.spec.ts` drives the real page in Chromium and
asserts the load-bearing states rather than merely that they render: every
card's nominal memory recomputed from the parameters that card prints, every
attacker guesses/sec figure recomputed from that card's own time and memory,
the timing bars against the times on the cards, the memory grids and both chart
scales against the true linear/log ratios, the RAM-wall rig's working and idle
lanes summing to the rig's cores, and each failure or tamper path — invalid
scrypt `N`, empty password, blank cost field, salt reuse, both **Weaken**
presets — driven to its end state and checked to also say *why*. Timings are
asserted as orderings and ratios, never absolute thresholds, so the suite is not
machine-dependent.

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
npx playwright install chromium   # one-time, for the browser gates / audit
npm run test:e2e                  # claims + WCAG A/AA gates (the CI gate)
npm run test:a11y                 # WCAG A/AA gate alone (axe-core, both themes)
npm run audit                     # build + axe + Lighthouse + SR-tree checks
```

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
