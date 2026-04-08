import { hkdf } from '@noble/hashes/hkdf.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { scrypt } from '@noble/hashes/scrypt.js';
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
  memoryEstimateKB: number;
  note?: string;
}

export function runHKDF(p: KDFParams): BenchResult {
  const info = new TextEncoder().encode('crypto-lab-kdf-arena');
  const start = performance.now();
  const output = hkdf(sha256, new TextEncoder().encode(p.password), p.salt, info, p.outputLength);
  const timeMs = performance.now() - start;
  return {
    kdf: 'HKDF-SHA256',
    params: { info: 'crypto-lab-kdf-arena', outputLength: p.outputLength },
    timeMs,
    output,
    memoryEstimateKB: 1,
    note: 'HKDF is NOT a password KDF — it is an extract-and-expand function for already-strong key material.',
  };
}

export function runPBKDF2(p: KDFParams, iterations = 600_000): BenchResult {
  const start = performance.now();
  const output = pbkdf2(sha256, p.password, p.salt, { c: iterations, dkLen: p.outputLength });
  const timeMs = performance.now() - start;
  return {
    kdf: 'PBKDF2-SHA256',
    params: { iterations, outputLength: p.outputLength },
    timeMs,
    output,
    memoryEstimateKB: 1,
  };
}

export function runScrypt(
  p: KDFParams,
  N = 131072,
  r = 8,
  blockP = 1,
): BenchResult {
  const start = performance.now();
  const output = scrypt(p.password, p.salt, { N, r, p: blockP, dkLen: p.outputLength });
  const timeMs = performance.now() - start;
  return {
    kdf: 'scrypt',
    params: { N, r, p: blockP, outputLength: p.outputLength },
    timeMs,
    output,
    memoryEstimateKB: Math.round((128 * N * r) / 1024),
  };
}

export async function runArgon2id(
  p: KDFParams,
  time = 3,
  memory = 65536,
  parallelism = 4,
): Promise<BenchResult> {
  const argon2 = await import('argon2-browser');
  const start = performance.now();
  const result = await argon2.hash({
    pass: p.password,
    salt: p.salt,
    time,
    mem: memory,
    hashLen: p.outputLength,
    parallelism,
    type: argon2.ArgonType.Argon2id,
  });
  const timeMs = performance.now() - start;
  return {
    kdf: 'Argon2id',
    params: { time, memory, parallelism, outputLength: p.outputLength },
    timeMs,
    output: result.hash,
    memoryEstimateKB: memory,
  };
}

export async function runAll(password: string): Promise<BenchResult[]> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const params: KDFParams = { password, salt, outputLength: 32 };

  const results: BenchResult[] = [];
  results.push(runHKDF(params));
  results.push(runPBKDF2(params));
  results.push(runScrypt(params));
  results.push(await runArgon2id(params));

  return results;
}
