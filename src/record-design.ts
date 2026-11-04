import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { runScrypt } from './bench.ts';

/** Public, invented inputs only. This exercise never reads the benchmark password. */
export const SYNTHETIC_DICTIONARY = Object.freeze([
  'demo-amber-otter',
  'demo-blue-fox',
  'demo-coral-owl',
  'demo-green-moth',
  'demo-indigo-yak',
  'demo-violet-wren',
] as const);

// Deliberately small, fixed work: at most 9 scrypt calls per complete exercise.
// The same public salt makes the three record designs directly comparable.
// Neither these costs nor this salt are production password-storage guidance.
export const RECORD_DEMO = Object.freeze({
  salt: 'kdf-record-demo!',
  N: 1024,
  r: 8,
  p: 1,
  outputLength: 32,
});

export type RecordKind = 'kdf-only' | 'plaintext-tail' | 'cheap-hash-tail';

export type SyntheticRecord =
  | { kind: 'kdf-only'; expensive: string }
  | { kind: 'plaintext-tail'; expensive: string; plaintext: string }
  | { kind: 'cheap-hash-tail'; expensive: string; cheapHash: string };

export interface OperationCounts {
  fCalls: number;
  hCalls: number;
  comparisons: number;
  disclosedReads: number;
}

export interface RecoveryStep {
  candidate: string;
  method: 'F' | 'H' | 'read';
  matched: boolean;
}

export interface Recovery {
  recovered: string | null;
  counts: OperationCounts;
  steps: RecoveryStep[];
}

export interface RecordTrial {
  record: SyntheticRecord;
  creation: OperationCounts;
  recovery: Recovery;
}

function emptyCounts(): OperationCounts {
  return { fCalls: 0, hCalls: 0, comparisons: 0, disclosedReads: 0 };
}

async function expensiveHash(password: string, counts: OperationCounts): Promise<string> {
  const result = await runScrypt({
    password,
    salt: new TextEncoder().encode(RECORD_DEMO.salt),
    outputLength: RECORD_DEMO.outputLength,
  }, RECORD_DEMO.N, RECORD_DEMO.r, RECORD_DEMO.p);
  counts.fCalls++;
  return bytesToHex(result.output);
}

function cheapHash(password: string, counts: OperationCounts): string {
  const result = bytesToHex(sha256(new TextEncoder().encode(password)));
  counts.hCalls++;
  return result;
}

export async function createSyntheticRecords(index: number): Promise<{
  record: SyntheticRecord;
  creation: OperationCounts;
}[]> {
  if (!Number.isInteger(index) || index < 0 || index >= SYNTHETIC_DICTIONARY.length) {
    throw new RangeError('Choose one of the six synthetic passwords.');
  }
  const password = SYNTHETIC_DICTIONARY[index];
  const records: { record: SyntheticRecord; creation: OperationCounts }[] = [];
  for (const kind of ['kdf-only', 'plaintext-tail', 'cheap-hash-tail'] as const) {
    const creation = emptyCounts();
    // Compute F for EACH record; no cached result or invented creation charge.
    const expensive = await expensiveHash(password, creation);
    const record: SyntheticRecord = kind === 'plaintext-tail'
      ? { kind, expensive, plaintext: password }
      : kind === 'cheap-hash-tail'
        ? { kind, expensive, cheapHash: cheapHash(password, creation) }
        : { kind, expensive };
    records.push({ record, creation });
  }
  return records;
}

/** The attacker receives only the record, the public parameters and dictionary. */
export async function recoverSyntheticRecord(record: SyntheticRecord): Promise<Recovery> {
  const counts = emptyCounts();
  const steps: RecoveryStep[] = [];
  if (record.kind === 'plaintext-tail') {
    counts.disclosedReads++;
    steps.push({ candidate: record.plaintext, method: 'read', matched: true });
    return { recovered: record.plaintext, counts, steps };
  }
  for (const candidate of SYNTHETIC_DICTIONARY) {
    const method = record.kind === 'kdf-only' ? 'F' : 'H';
    const actual = record.kind === 'kdf-only'
      ? await expensiveHash(candidate, counts)
      : cheapHash(candidate, counts);
    const expected = record.kind === 'kdf-only' ? record.expensive : record.cheapHash;
    counts.comparisons++;
    const matched = actual === expected;
    steps.push({ candidate, method, matched });
    if (matched) return { recovered: candidate, counts, steps };
  }
  return { recovered: null, counts, steps };
}

export async function runRecordExercise(index: number): Promise<RecordTrial[]> {
  const records = await createSyntheticRecords(index);
  const trials: RecordTrial[] = [];
  for (const { record, creation } of records) {
    trials.push({ record, creation, recovery: await recoverSyntheticRecord(record) });
  }
  return trials;
}
