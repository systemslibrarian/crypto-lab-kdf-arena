import { describe, expect, it } from 'vitest';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  RECORD_DEMO,
  SYNTHETIC_DICTIONARY,
  createSyntheticRecords,
  recoverSyntheticRecord,
  runRecordExercise,
} from '../src/record-design.ts';

describe('whole-record password recovery exercise', () => {
  it('creates real scrypt and SHA-256 fields and charges each independent creation', async () => {
    const index = 2;
    const password = SYNTHETIC_DICTIONARY[index];
    const created = await createSyntheticRecords(index);
    const expectedF = bytesToHex(scrypt(password, new TextEncoder().encode(RECORD_DEMO.salt), {
      N: 1024, r: 8, p: 1, dkLen: 32,
    }));
    expect(created.map(({ record }) => record.expensive)).toEqual([expectedF, expectedF, expectedF]);
    expect(created[1].record).toEqual({ kind: 'plaintext-tail', expensive: expectedF, plaintext: password });
    expect(created[2].record).toEqual({
      kind: 'cheap-hash-tail', expensive: expectedF,
      cheapHash: bytesToHex(sha256(new TextEncoder().encode(password))),
    });
    expect(created.map(({ creation }) => creation)).toEqual([
      { fCalls: 1, hCalls: 0, comparisons: 0, disclosedReads: 0 },
      { fCalls: 1, hCalls: 0, comparisons: 0, disclosedReads: 0 },
      { fCalls: 1, hCalls: 1, comparisons: 0, disclosedReads: 0 },
    ]);
  });

  it.each([0, 2, 5])('counts actual recoveries at dictionary position %i and stops on the match', async (index) => {
    const trials = await runRecordExercise(index);
    const attempts = index + 1;
    expect(trials.map(({ recovery }) => recovery.recovered)).toEqual(Array(3).fill(SYNTHETIC_DICTIONARY[index]));
    expect(trials.map(({ recovery }) => recovery.counts)).toEqual([
      { fCalls: attempts, hCalls: 0, comparisons: attempts, disclosedReads: 0 },
      { fCalls: 0, hCalls: 0, comparisons: 0, disclosedReads: 1 },
      { fCalls: 0, hCalls: attempts, comparisons: attempts, disclosedReads: 0 },
    ]);
    for (const i of [0, 2]) {
      const steps = trials[i].recovery.steps;
      expect(steps.map((step) => step.candidate)).toEqual(SYNTHETIC_DICTIONARY.slice(0, attempts));
      expect(steps.filter((step) => step.matched)).toHaveLength(1);
      expect(steps.at(-1)?.matched).toBe(true);
      expect(steps.map((step) => step.method)).toEqual(Array(attempts).fill(i === 0 ? 'F' : 'H'));
    }
  });

  it('exhausts the bounded dictionary when no digest matches instead of inventing recovery', async () => {
    const result = await recoverSyntheticRecord({ kind: 'kdf-only', expensive: 'not-a-scrypt-output' });
    expect(result.recovered).toBeNull();
    expect(result.counts).toEqual({ fCalls: 6, hCalls: 0, comparisons: 6, disclosedReads: 0 });
    expect(result.steps.every((step) => !step.matched)).toBe(true);
    const cheap = await recoverSyntheticRecord({ kind: 'cheap-hash-tail', expensive: '', cheapHash: 'not-a-sha256-output' });
    expect(cheap.recovered).toBeNull();
    expect(cheap.counts).toEqual({ fCalls: 0, hCalls: 6, comparisons: 6, disclosedReads: 0 });
  });

  it('really bypasses F: a corrupted F field does not impede the two leaking designs', async () => {
    const created = await createSyntheticRecords(1);
    for (const { record } of created.slice(1)) {
      const result = await recoverSyntheticRecord({ ...record, expensive: 'corrupted' });
      expect(result.recovered).toBe(SYNTHETIC_DICTIONARY[1]);
      expect(result.counts.fCalls).toBe(0);
    }
  });

  it('uses distinct SHA-256 values for all six candidates; a cheap match is unambiguous here', () => {
    const hashes = SYNTHETIC_DICTIONARY.map((password) => bytesToHex(sha256(new TextEncoder().encode(password))));
    expect(new Set(hashes).size).toBe(SYNTHETIC_DICTIONARY.length);
  });

  it.each([-1, 6, 0.5, NaN, Infinity])('rejects selection %s outside the fixed dictionary', async (index) => {
    await expect(createSyntheticRecords(index)).rejects.toThrow('six synthetic passwords');
  });
});
