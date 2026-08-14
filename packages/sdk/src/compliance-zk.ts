/**
 * Compliance ZK gate — prove notExpired ∧ score≥T ∧ country∈allowlist
 * without revealing claims to the curator.
 *
 * Modes:
 * - algebraic: holder-side / tests (opens commitment locally; not for curator UI)
 * - groth16: when packages/zk-compliance artifacts are built (snarkjs)
 */
import type { Address, Hex } from "viem";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
} from "viem";
import {
  CLAIMS_SCHEMA_KIND,
  codeToCountry,
  computeClaimsCommitment,
  countryToCode,
  scoreToBps,
  type ClaimsCommitmentInput,
} from "./commitment";

export type CompliancePolicy = {
  minScoreBps: number;
  /** ISO alpha-2 allowlist */
  allowlist: string[];
  /** Unix seconds — typically Date.now()/1000 */
  now: number;
};

export type ComplianceWitness = {
  live: {
    scoreBps: number;
    expiresAtUnix: number;
    subject: Address;
    salt: Hex;
    commitment: Hex;
    credHash: Hex;
  };
  residence: {
    country: string;
    expiresAtUnix: number;
    subject: Address;
    salt: Hex;
    commitment: Hex;
    credHash: Hex;
  };
};

export type ComplianceGatePublicSignals = {
  liveCommitment: Hex;
  resCommitment: Hex;
  minScoreBps: number;
  allowlistRoot: Hex;
  now: number;
  liveCredHash: Hex;
  resCredHash: Hex;
};

export type ComplianceGateProof = {
  mode: "algebraic" | "groth16";
  publicSignals: ComplianceGatePublicSignals;
  /** Opaque groth16 proof JSON when mode=groth16 */
  proof?: unknown;
  /** Only present in algebraic mode (never send to curator) */
  _debugWitness?: ComplianceWitness;
};

/** Deterministic allowlist root: keccak of sorted country codes. */
export function computeAllowlistRoot(allowlist: string[]): Hex {
  const codes = [
    ...new Set(allowlist.map((c) => countryToCode(c)).filter((n) => n > 0)),
  ].sort((a, b) => a - b);
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256[]"), [
      codes.map((c) => BigInt(c)),
    ])
  );
}

function countryInAllowlist(country: string, allowlist: string[]): boolean {
  const set = new Set(allowlist.map((c) => c.trim().toUpperCase()));
  return set.has(country.trim().toUpperCase());
}

export function verifyCommitmentOpening(
  input: ClaimsCommitmentInput,
  expected: Hex
): boolean {
  return computeClaimsCommitment(input).toLowerCase() === expected.toLowerCase();
}

/**
 * Build an algebraic compliance proof (for tests / holder self-check).
 * Curators should prefer groth16 mode so witnesses never leave the wallet.
 */
export function proveComplianceGateAlgebraic(
  witness: ComplianceWitness,
  policy: CompliancePolicy
): ComplianceGateProof {
  const liveOk = verifyCommitmentOpening(
    {
      schemaKind: CLAIMS_SCHEMA_KIND.Liveness,
      countryCode: 0,
      scoreBps: witness.live.scoreBps,
      expiresAtUnix: witness.live.expiresAtUnix,
      subject: witness.live.subject,
      salt: witness.live.salt,
    },
    witness.live.commitment
  );
  const resOk = verifyCommitmentOpening(
    {
      schemaKind: CLAIMS_SCHEMA_KIND.Residence,
      countryCode: countryToCode(witness.residence.country),
      scoreBps: 0,
      expiresAtUnix: witness.residence.expiresAtUnix,
      subject: witness.residence.subject,
      salt: witness.residence.salt,
    },
    witness.residence.commitment
  );
  if (!liveOk || !resOk) {
    throw new Error("commitment opening failed");
  }
  if (witness.live.expiresAtUnix < policy.now) {
    throw new Error("liveness expired");
  }
  if (witness.residence.expiresAtUnix < policy.now) {
    throw new Error("residence expired");
  }
  if (witness.live.scoreBps < policy.minScoreBps) {
    throw new Error("liveness score below policy");
  }
  if (!countryInAllowlist(witness.residence.country, policy.allowlist)) {
    throw new Error("country not in allowlist");
  }
  if (
    witness.live.subject.toLowerCase() !==
    witness.residence.subject.toLowerCase()
  ) {
    throw new Error("subject mismatch");
  }

  return {
    mode: "algebraic",
    publicSignals: {
      liveCommitment: witness.live.commitment,
      resCommitment: witness.residence.commitment,
      minScoreBps: policy.minScoreBps,
      allowlistRoot: computeAllowlistRoot(policy.allowlist),
      now: policy.now,
      liveCredHash: witness.live.credHash,
      resCredHash: witness.residence.credHash,
    },
    _debugWitness: witness,
  };
}

export type VerifyComplianceGateResult = {
  ok: boolean;
  error?: string;
};

/**
 * Verify algebraic proof against policy + expected on-chain commitments.
 * Does not accept _debugWitness from untrusted parties — openings must be
 * re-derived only in groth16 mode. Algebraic verify requires matching
 * publicSignals to registry commitments and policy root/now/score.
 */
export function verifyComplianceGatePublic(
  proof: ComplianceGateProof,
  expected: {
    liveCommitment: Hex;
    resCommitment: Hex;
    policy: CompliancePolicy;
  }
): VerifyComplianceGateResult {
  const p = proof.publicSignals;
  if (p.liveCommitment.toLowerCase() !== expected.liveCommitment.toLowerCase()) {
    return { ok: false, error: "liveCommitment mismatch" };
  }
  if (p.resCommitment.toLowerCase() !== expected.resCommitment.toLowerCase()) {
    return { ok: false, error: "resCommitment mismatch" };
  }
  if (p.minScoreBps !== expected.policy.minScoreBps) {
    return { ok: false, error: "minScoreBps mismatch" };
  }
  const root = computeAllowlistRoot(expected.policy.allowlist);
  if (p.allowlistRoot.toLowerCase() !== root.toLowerCase()) {
    return { ok: false, error: "allowlistRoot mismatch" };
  }
  if (p.now < expected.policy.now) {
    return { ok: false, error: "stale now signal" };
  }
  if (proof.mode === "algebraic") {
    // Algebraic proofs must not be trusted from remote parties without witness.
    // Self-check path: re-run policy on _debugWitness if present.
    const w = proof._debugWitness;
    if (!w) {
      return {
        ok: false,
        error: "algebraic proof without witness — use groth16 for remote verify",
      };
    }
    try {
      proveComplianceGateAlgebraic(w, expected.policy);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  // groth16: snarkjs verify happens in @peranto/zk-compliance
  return {
    ok: false,
    error: "groth16 verify requires @peranto/zk-compliance artifacts",
  };
}

export { countryToCode, codeToCountry, scoreToBps };
