/**
 * Witness mapping shared by Node bb and Aura (browser WASM).
 */
import type { CompliancePolicy, ComplianceWitness } from "@peranto/sdk";
import {
  allowlistCodes,
  computeAllowlistRoot,
  countryToCode,
  proveComplianceGateAlgebraic,
  toField,
} from "@peranto/sdk";

function fieldStr(v: bigint | number | string): string {
  return toField(v).toString();
}

export function honkInputs(
  witness: ComplianceWitness,
  policy: CompliancePolicy
) {
  proveComplianceGateAlgebraic(witness, policy);
  const codes = allowlistCodes(policy.allowlist);
  return {
    live_commitment: fieldStr(witness.live.commitment),
    res_commitment: fieldStr(witness.residence.commitment),
    min_score_bps: fieldStr(policy.minScoreBps),
    allowlist_root_pub: fieldStr(computeAllowlistRoot(policy.allowlist)),
    now: fieldStr(policy.now),
    score_bps: fieldStr(witness.live.scoreBps),
    live_expires: fieldStr(witness.live.expiresAtUnix),
    live_salt: fieldStr(witness.live.salt),
    res_country: fieldStr(countryToCode(witness.residence.country)),
    res_expires: fieldStr(witness.residence.expiresAtUnix),
    res_salt: fieldStr(witness.residence.salt),
    subject: fieldStr(witness.live.subject),
    allowlist: codes.map((c) => fieldStr(c)),
  };
}

export function bytesToHex(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i++) s += u[i]!.toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(h: string): Uint8Array {
  const hex = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export type HonkPackedProof = {
  proof: string;
  publicInputs: string[];
};

/** First 5 UltraHonk public inputs = circuit pubs (pairing points are in the proof). */
export function honkCircuitPublicInputs(
  packed: HonkPackedProof
): `0x${string}`[] {
  return packed.publicInputs.slice(0, 5).map((x) => {
    const hex = x.startsWith("0x") ? x.slice(2) : x;
    return `0x${hex.padStart(64, "0")}` as `0x${string}`;
  });
}
