import { hkdf } from '@noble/hashes/hkdf.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { sha256 } from '@noble/hashes/sha2.js';

export interface KDFParams {
  password: string;
  salt: Uint8Array;
  outputLength: number;
}

export interface BenchResult {
  kdf: string;
  params: Record<string, unknown>;
  timeMs: number;
  output: Uint8Array;
  /**
   * Nominal working-set size in KiB. This is NOT measured — for the
   * memory-hard KDFs it is the algorithm's defined memory cost (scrypt:
   * 128*N*r bytes; Argon2: the `memory` parameter). For HKDF/PBKDF2 it is
   * the small, roughly-constant scratch space they use (a handful of hash
   * states); those functions are compute-bound, not memory-hard, so the
   * figure is deliberately tiny and approximate.
   */
  memoryNominalKB: number;
  note?: string;
}

/**
 * Illustrative attacker model (NOT a measurement, and deliberately labelled as
 * an estimate in the UI). It answers the pedagogical question "why do these
 * parameters matter to an attacker?" by turning the two honest, real numbers we
 * already have — the measured wall-clock derivation time and the algorithm's
 * defined memory cost — into a single figure a newcomer can reason about:
 * how many password guesses per second one attacker box can make.
 *
 * Two ceilings bound a real cracking rig, and the attacker gets the LOWER of them:
 *   • compute ceiling  — a rig runs many derivations in parallel; each still
 *     takes ~`timeMs`, so rate ≈ (parallel lanes) / time.
 *   • memory ceiling   — a memory-hard KDF forces each in-flight guess to hold
 *     its whole working set in RAM, so a rig with fixed RAM can only run
 *     (rig RAM) / (per-guess RAM) guesses at once. This is the term that makes
 *     Argon2id/scrypt expensive and PBKDF2/HKDF cheap, which is the whole point.
 *
 * The reference numbers below are a single, clearly-stated hypothetical rig,
 * not a claim about any specific GPU. Changing a cost knob moves the estimate
 * by the same *ratio* a real attacker would see, which is the intuition we want
 * to teach; the absolute magnitude is explicitly framed as "order-of-magnitude".
 */
export const ATTACKER = {
  // A hypothetical rig: massively parallel, but with finite fast memory.
  parallelLanes: 8192, // concurrent derivations when memory is not the bottleneck
  ramKB: 8 * 1024 * 1024, // 8 GiB of fast memory available to the cracker
  // PBKDF2/HKDF are compute-bound: their "1 KB" nominal figure is scratch, not a
  // memory wall, so an attacker can pack effectively unlimited lanes. We cap the
  // memory ceiling for those at the compute ceiling by treating their per-guess
  // RAM as negligible (handled below via a floor on the divisor).
};

export interface AttackerEstimate {
  guessesPerSec: number;
  /** Which ceiling dominates — teaches *why* the number is what it is. */
  boundedBy: 'compute' | 'memory';
}

export function estimateAttacker(r: BenchResult): AttackerEstimate {
  const timeSec = Math.max(r.timeMs, 0.001) / 1000;
  const computeRate = ATTACKER.parallelLanes / timeSec;
  // Memory ceiling only bites for memory-hard KDFs. For the compute-bound ones
  // (nominal ~1 KB) the per-guess footprint is not a real wall, so we let their
  // memory ceiling sit at/above the compute ceiling and compute stays dominant.
  const perGuessKB = Math.max(r.memoryNominalKB, 1);
  const concurrent = ATTACKER.ramKB / perGuessKB;
  const memoryRate = concurrent / timeSec;
  const guessesPerSec = Math.min(computeRate, memoryRate);
  return {
    guessesPerSec,
    boundedBy: memoryRate < computeRate ? 'memory' : 'compute',
  };
}

const HKDF_INFO = 'crypto-lab-kdf-arena';

export function runHKDF(p: KDFParams): BenchResult {
  const info = new TextEncoder().encode(HKDF_INFO);
  const start = performance.now();
  const output = hkdf(sha256, new TextEncoder().encode(p.password), p.salt, info, p.outputLength);
  const timeMs = performance.now() - start;
  return {
    kdf: 'HKDF-SHA256',
    params: { info: HKDF_INFO, outputLength: p.outputLength },
    timeMs,
    output,
    memoryNominalKB: 1,
    note: 'HKDF is NOT a password KDF — it is an extract-and-expand function for already-strong key material.',
  };
}

export async function runPBKDF2(p: KDFParams, iterations = 600_000): Promise<BenchResult> {
  const start = performance.now();
  const output = await pbkdf2Async(sha256, p.password, p.salt, { c: iterations, dkLen: p.outputLength });
  const timeMs = performance.now() - start;
  return {
    kdf: 'PBKDF2-SHA256',
    params: { iterations, outputLength: p.outputLength },
    timeMs,
    output,
    memoryNominalKB: 1,
  };
}

export async function runScrypt(
  p: KDFParams,
  N = 131072,
  r = 8,
  blockP = 1,
): Promise<BenchResult> {
  const start = performance.now();
  const output = await scryptAsync(p.password, p.salt, { N, r, p: blockP, dkLen: p.outputLength });
  const timeMs = performance.now() - start;
  return {
    kdf: 'scrypt',
    params: { N, r, p: blockP, outputLength: p.outputLength },
    timeMs,
    output,
    memoryNominalKB: Math.round((128 * N * r) / 1024),
  };
}

export async function runArgon2id(
  p: KDFParams,
  time = 3,
  memory = 65536,
  parallelism = 4,
): Promise<BenchResult> {
  const start = performance.now();
  // @noble/hashes argon2id — pure JS, no WASM. `m` is in KiB, matching the
  // `memory` label used across this UI and the RFC 9106 parameter naming.
  const output = await argon2idAsync(p.password, p.salt, {
    t: time,
    m: memory,
    p: parallelism,
    dkLen: p.outputLength,
  });
  const timeMs = performance.now() - start;
  return {
    kdf: 'Argon2id',
    params: { time, memory, parallelism, outputLength: p.outputLength },
    timeMs,
    output,
    memoryNominalKB: memory,
  };
}

export interface RunOptions {
  pbkdf2Iterations?: number;
  scryptN?: number;
  scryptR?: number;
  scryptP?: number;
  argon2Time?: number;
  argon2Memory?: number;
  argon2Parallelism?: number;
  /**
   * A fixed salt to reuse across runs, for the "reuse salt" teaching toggle.
   * Omitted (the default) means a fresh random 16-byte salt per run — the
   * correct, real-world behaviour that makes identical passwords derive
   * different keys. Reusing a salt is deliberately shown as the *insecure*
   * case that makes the derived key repeat.
   */
  fixedSalt?: Uint8Array;
}

export async function runAll(
  password: string,
  opts: RunOptions = {},
): Promise<{ results: BenchResult[]; salt: Uint8Array }> {
  const salt = opts.fixedSalt ?? crypto.getRandomValues(new Uint8Array(16));
  const params: KDFParams = { password, salt, outputLength: 32 };

  const results: BenchResult[] = [];
  results.push(runHKDF(params));
  results.push(await runPBKDF2(params, opts.pbkdf2Iterations));
  results.push(await runScrypt(params, opts.scryptN, opts.scryptR, opts.scryptP));
  results.push(
    await runArgon2id(params, opts.argon2Time, opts.argon2Memory, opts.argon2Parallelism),
  );

  return { results, salt };
}
