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
}

export async function runAll(password: string, opts: RunOptions = {}): Promise<BenchResult[]> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const params: KDFParams = { password, salt, outputLength: 32 };

  const results: BenchResult[] = [];
  results.push(runHKDF(params));
  results.push(await runPBKDF2(params, opts.pbkdf2Iterations));
  results.push(await runScrypt(params, opts.scryptN, opts.scryptR, opts.scryptP));
  results.push(
    await runArgon2id(params, opts.argon2Time, opts.argon2Memory, opts.argon2Parallelism),
  );

  return results;
}
