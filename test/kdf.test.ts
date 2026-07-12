/**
 * kdf.test.ts — RFC known-answer tests for every KDF the arena benchmarks.
 *
 * The demo's honesty claim is "these are the real, standard KDFs." That is
 * only trustworthy if the code reproduces the standards' own published
 * vectors byte-for-byte. These tests recompute each RFC vector through the
 * SAME functions the UI calls (src/bench.ts), so a regression that silently
 * broke the crypto — wrong parameter, swapped algorithm, truncated output —
 * would fail here instead of shipping.
 */
import { describe, expect, test } from 'vitest';

import { hkdf } from '@noble/hashes/hkdf.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  runHKDF,
  runPBKDF2,
  runScrypt,
  runArgon2id,
  runAll,
  estimateAttacker,
  type BenchResult,
} from '../src/bench.ts';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytes(h: string): Uint8Array {
  const clean = h.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ── RFC known-answer vectors ─────────────────────────────────────────────────
// These test the underlying primitives at their published test-case
// parameters (which the bench wrappers cannot exercise directly because they
// hash a string password + random salt at fixed output length).

describe('RFC known-answer vectors', () => {
  test('HKDF-SHA256 reproduces RFC 5869 Test Case 1', () => {
    const ikm = bytes('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
    const salt = bytes('000102030405060708090a0b0c');
    const info = bytes('f0f1f2f3f4f5f6f7f8f9');
    const okm = hkdf(sha256, ikm, salt, info, 42);
    expect(hex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  test('HKDF-SHA256 reproduces RFC 5869 Test Case 3 (empty salt & info)', () => {
    const ikm = bytes('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
    const okm = hkdf(sha256, ikm, new Uint8Array(0), new Uint8Array(0), 42);
    expect(hex(okm)).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });

  test('PBKDF2-HMAC-SHA256 reproduces RFC 7914 §10 (c=1, 64 B)', () => {
    const dk = pbkdf2(sha256, 'passwd', 'salt', { c: 1, dkLen: 64 });
    expect(hex(dk)).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc' +
        '49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
  });

  test('PBKDF2-HMAC-SHA256 reproduces RFC 7914 §10 (c=80000, 64 B)', () => {
    const dk = pbkdf2(sha256, 'Password', 'NaCl', { c: 80000, dkLen: 64 });
    expect(hex(dk)).toBe(
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56' +
        'a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d',
    );
  });

  test('scrypt reproduces RFC 7914 §12 (N=16,r=1,p=1, empty pw/salt)', () => {
    const dk = scrypt('', '', { N: 16, r: 1, p: 1, dkLen: 64 });
    expect(hex(dk)).toBe(
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442' +
        'fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    );
  });

  test('scrypt reproduces RFC 7914 §12 (N=1024,r=8,p=16, "password"/"NaCl")', () => {
    const dk = scrypt('password', 'NaCl', { N: 1024, r: 8, p: 16, dkLen: 64 });
    expect(hex(dk)).toBe(
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162' +
        '2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
    );
  });

  test('Argon2id reproduces RFC 9106 §5.3 reference vector', () => {
    // password = 32 * 0x01, salt = 16 * 0x02, secret key = 8 * 0x03,
    // associated data = 12 * 0x04, t=3, m=32 KiB, p=4, tag length 32.
    const out = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
      t: 3,
      m: 32,
      p: 4,
      key: new Uint8Array(8).fill(3),
      personalization: new Uint8Array(12).fill(4),
      dkLen: 32,
    });
    expect(hex(out)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  });
});

// ── Bench wrappers: the actual code path the UI runs ─────────────────────────

const enc = (s: string) => new TextEncoder().encode(s);

describe('bench wrappers derive correct, deterministic keys', () => {
  test('runHKDF matches a direct noble HKDF call and is context-bound', () => {
    const salt = bytes('000102030405060708090a0b0c0d0e0f');
    const r = runHKDF({ password: 'pw', salt, outputLength: 32 });
    const expected = hkdf(sha256, enc('pw'), salt, enc('crypto-lab-kdf-arena'), 32);
    expect(hex(r.output)).toBe(hex(expected));
    expect(r.output).toHaveLength(32);
    expect(r.kdf).toBe('HKDF-SHA256');
    expect(r.note).toMatch(/NOT a password KDF/i);
  });

  test('runPBKDF2 honors the iteration parameter (KAT via RFC 7914)', async () => {
    const r = await runPBKDF2({ password: 'passwd', salt: enc('salt'), outputLength: 64 }, 1);
    expect(hex(r.output)).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc' +
        '49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
    expect(r.params.iterations).toBe(1);
  });

  test('runScrypt honors N/r/p (KAT via RFC 7914)', async () => {
    const r = await runScrypt({ password: 'password', salt: enc('NaCl'), outputLength: 64 }, 1024, 8, 16);
    expect(hex(r.output)).toBe(
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162' +
        '2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
    );
    expect(r.memoryNominalKB).toBe(Math.round((128 * 1024 * 8) / 1024));
  });

  test('runArgon2id matches a direct noble argon2id call', async () => {
    const salt = new Uint8Array(16).fill(9);
    const r = await runArgon2id({ password: 'pw', salt, outputLength: 32 }, 2, 256, 2);
    const expected = argon2id('pw', salt, { t: 2, m: 256, p: 2, dkLen: 32 });
    expect(hex(r.output)).toBe(hex(expected));
    expect(r.params).toMatchObject({ time: 2, memory: 256, parallelism: 2 });
    expect(r.memoryNominalKB).toBe(256);
  });

  test('lowering the cost parameter changes the derived key (params are live)', async () => {
    const salt = new Uint8Array(16).fill(7);
    const strong = await runPBKDF2({ password: 'pw', salt, outputLength: 32 }, 600_000);
    const weak = await runPBKDF2({ password: 'pw', salt, outputLength: 32 }, 1000);
    expect(hex(strong.output)).not.toBe(hex(weak.output));
  });
});

describe('runAll', () => {
  test('runs all four KDFs and wires options through to each', async () => {
    const { results } = await runAll('correct horse battery staple', {
      pbkdf2Iterations: 1000,
      scryptN: 256,
      scryptR: 8,
      scryptP: 1,
      argon2Time: 1,
      argon2Memory: 256,
      argon2Parallelism: 1,
    });
    expect(results.map((r) => r.kdf)).toEqual([
      'HKDF-SHA256',
      'PBKDF2-SHA256',
      'scrypt',
      'Argon2id',
    ]);
    for (const r of results) {
      expect(r.output).toHaveLength(32);
      expect(r.timeMs).toBeGreaterThanOrEqual(0);
    }
    expect(results[1].params.iterations).toBe(1000);
    expect(results[2].params).toMatchObject({ N: 256, r: 8, p: 1 });
    expect(results[3].params).toMatchObject({ time: 1, memory: 256, parallelism: 1 });
  });

  test('a fixed salt reproduces identical keys across runs (rainbow-table lesson)', async () => {
    const salt = new Uint8Array(16).fill(0x5a);
    const fast = { pbkdf2Iterations: 1000, scryptN: 256, argon2Time: 1, argon2Memory: 256, argon2Parallelism: 1, fixedSalt: salt };
    const a = await runAll('pw', fast);
    const b = await runAll('pw', fast);
    // With the salt pinned, every KDF must derive the SAME key both runs — the
    // visible symptom the "reuse salt" toggle teaches.
    for (let i = 0; i < a.results.length; i++) {
      expect(hex(a.results[i].output)).toBe(hex(b.results[i].output));
    }
    expect(hex(a.salt)).toBe(hex(salt));
  });

  test('a random salt makes two runs of the same password differ', async () => {
    const fast = { pbkdf2Iterations: 1000, scryptN: 256, argon2Time: 1, argon2Memory: 256, argon2Parallelism: 1 };
    const a = await runAll('pw', fast);
    const b = await runAll('pw', fast);
    // HKDF/PBKDF2/scrypt/Argon2id all take the per-run random salt, so every
    // derived key should differ between runs.
    for (let i = 0; i < a.results.length; i++) {
      expect(hex(a.results[i].output)).not.toBe(hex(b.results[i].output));
    }
  });

  test('estimateAttacker: memory-hard KDFs are RAM-bound and far slower to crack', () => {
    const base = { params: {}, timeMs: 50, output: new Uint8Array(32) };
    const pbkdf2: BenchResult = { ...base, kdf: 'PBKDF2-SHA256', memoryNominalKB: 1 };
    const argon2: BenchResult = { ...base, kdf: 'Argon2id', memoryNominalKB: 65_536 };
    const ep = estimateAttacker(pbkdf2);
    const ea = estimateAttacker(argon2);
    // Same time, but Argon2id's memory wall drops the attacker's rate hard and
    // flips the bottleneck from compute to memory — the whole teaching point.
    expect(ep.boundedBy).toBe('compute');
    expect(ea.boundedBy).toBe('memory');
    expect(ea.guessesPerSec).toBeLessThan(ep.guessesPerSec);
  });
});
