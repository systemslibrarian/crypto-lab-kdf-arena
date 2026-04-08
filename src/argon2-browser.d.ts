declare module 'argon2-browser' {
  export enum ArgonType {
    Argon2d = 0,
    Argon2i = 1,
    Argon2id = 2,
  }

  export interface Argon2HashOptions {
    pass: string | Uint8Array;
    salt: string | Uint8Array;
    time?: number;
    mem?: number;
    hashLen?: number;
    parallelism?: number;
    type?: ArgonType;
    secret?: Uint8Array;
    ad?: Uint8Array;
  }

  export interface Argon2HashResult {
    hash: Uint8Array;
    hashHex: string;
    encoded: string;
  }

  export function hash(options: Argon2HashOptions): Promise<Argon2HashResult>;
  export function unloadRuntime(): void;
}
