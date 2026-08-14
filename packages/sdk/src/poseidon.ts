/**
 * Circom/Noir Poseidon-128 (x^5) over BN254 — matches
 * `poseidon::poseidon::bn254::hash_N` (noir-lang/poseidon).
 */
import {
  poseidon7 as poseidon7Lite,
  poseidon8 as poseidon8Lite,
} from "poseidon-lite";
import type { Hex } from "viem";

/** BN254 scalar field (same as Noir Field / Barretenberg Fr). */
export const BN254_FR =
  21888242871839275222246405745257275088548364400416034343698204167893073703225n;

/** Domain separator for Poseidon-era claims commitments (keccak era was implicit). */
export const CLAIMS_COMMIT_VERSION = 2n;

export const ALLOWLIST_MAX = 8;

export function toField(value: bigint | number | string | Hex): bigint {
  const n =
    typeof value === "bigint"
      ? value
      : typeof value === "number"
        ? BigInt(value)
        : BigInt(value);
  const mod = n % BN254_FR;
  return mod < 0n ? mod + BN254_FR : mod;
}

export function fieldToHex(n: bigint): Hex {
  const f = toField(n);
  return `0x${f.toString(16).padStart(64, "0")}` as Hex;
}

export function poseidon7(inputs: readonly bigint[]): bigint {
  if (inputs.length !== 7) throw new Error("poseidon7: expected 7 fields");
  return BigInt(poseidon7Lite(inputs.map((x) => toField(x))));
}

export function poseidon8(inputs: readonly bigint[]): bigint {
  if (inputs.length !== 8) throw new Error("poseidon8: expected 8 fields");
  return BigInt(poseidon8Lite(inputs.map((x) => toField(x))));
}
