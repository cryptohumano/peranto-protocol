/**
 * Claims commitment for compliance VCs (liveness / residence).
 * Stored on-chain via CredentialStatusRegistry.anchorV2; opened in ZK gate.
 *
 * Poseidon-128 / Circom (Noir `hash_7`), domain-separated:
 *   H = poseidon7(version=2, schemaKind, countryCode, scoreBps, expiresAtUnix, subject, salt)
 *
 * schemaKind: 1 = Liveness, 2 = Residence
 * countryCode: ISO alpha-2 packed (MX → 1324); 0 if unused
 * scoreBps: score * 10000 (e.g. 0.95 → 9500); 0 if unused
 * salt/subject reduced into BN254 Fr
 */
import { type Address, type Hex } from "viem";
import {
  CLAIMS_COMMIT_VERSION,
  fieldToHex,
  poseidon7,
  toField,
} from "./poseidon";

export const CLAIMS_SCHEMA_KIND = {
  Liveness: 1n,
  Residence: 2n,
} as const;

export type ClaimsCommitmentInput = {
  schemaKind: bigint;
  countryCode: number;
  scoreBps: number;
  expiresAtUnix: number;
  subject: Address;
  salt: Hex;
};

/** Encode ISO 3166-1 alpha-2 → uint (MX → 1324). */
export function countryToCode(country: string): number {
  const c = country.trim().toUpperCase();
  if (c.length !== 2) return 0;
  const a = c.charCodeAt(0) - 64; // A=1
  const b = c.charCodeAt(1) - 64;
  if (a < 1 || a > 26 || b < 1 || b > 26) return 0;
  return a * 100 + b;
}

export function codeToCountry(code: number): string {
  if (code <= 0) return "";
  const a = Math.floor(code / 100);
  const b = code % 100;
  if (a < 1 || a > 26 || b < 1 || b > 26) return "";
  return String.fromCharCode(64 + a, 64 + b);
}

export function scoreToBps(score: number | string): number {
  const n = typeof score === "string" ? Number(score) : score;
  if (!Number.isFinite(n)) return 0;
  // Accept already-bps (>= 1 and integer-ish > 1) or 0..1 fraction
  if (n > 1) return Math.round(n);
  return Math.round(n * 10_000);
}

export function expiresAtToUnix(expiresAt: string | number | Date): number {
  if (typeof expiresAt === "number") return Math.floor(expiresAt);
  const t = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(t)) throw new Error("invalid expiresAt");
  return Math.floor(t / 1000);
}

export function computeClaimsCommitment(input: ClaimsCommitmentInput): Hex {
  return fieldToHex(
    poseidon7([
      CLAIMS_COMMIT_VERSION,
      toField(input.schemaKind),
      toField(input.countryCode),
      toField(input.scoreBps),
      toField(input.expiresAtUnix),
      toField(input.subject),
      toField(input.salt),
    ])
  );
}

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Keep salt inside BN254 Fr so it is a valid Noir Field witness.
  bytes[0] = 0;
  return (`0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`) as Hex;
}

export const DEFAULT_TTL_SECONDS = {
  liveness: 30 * 24 * 60 * 60,
  residence: 90 * 24 * 60 * 60,
} as const;

export function buildLivenessCommitment(params: {
  score: number | string;
  expiresAt: string | number | Date;
  subject: Address;
  salt?: Hex;
}): { commitment: Hex; salt: Hex; expiresAtUnix: number; scoreBps: number } {
  const salt = params.salt ?? randomSalt();
  const expiresAtUnix = expiresAtToUnix(params.expiresAt);
  const scoreBps = scoreToBps(params.score);
  const commitment = computeClaimsCommitment({
    schemaKind: CLAIMS_SCHEMA_KIND.Liveness,
    countryCode: 0,
    scoreBps,
    expiresAtUnix,
    subject: params.subject,
    salt,
  });
  return { commitment, salt, expiresAtUnix, scoreBps };
}

export function buildResidenceCommitment(params: {
  country: string;
  expiresAt: string | number | Date;
  subject: Address;
  salt?: Hex;
}): { commitment: Hex; salt: Hex; expiresAtUnix: number; countryCode: number } {
  const salt = params.salt ?? randomSalt();
  const expiresAtUnix = expiresAtToUnix(params.expiresAt);
  const countryCode = countryToCode(params.country);
  const commitment = computeClaimsCommitment({
    schemaKind: CLAIMS_SCHEMA_KIND.Residence,
    countryCode,
    scoreBps: 0,
    expiresAtUnix,
    subject: params.subject,
    salt,
  });
  return { commitment, salt, expiresAtUnix, countryCode };
}
