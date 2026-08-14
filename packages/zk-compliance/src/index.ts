/**
 * Re-exports SDK algebraic gate + optional snarkjs groth16 when artifacts exist.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  proveComplianceGateAlgebraic,
  verifyComplianceGatePublic,
  computeAllowlistRoot,
  type ComplianceGateProof,
  type CompliancePolicy,
  type ComplianceWitness,
} from "@peranto/sdk";

export {
  proveComplianceGateAlgebraic,
  verifyComplianceGatePublic,
  computeAllowlistRoot,
};
export type { ComplianceGateProof, CompliancePolicy, ComplianceWitness };

const __dirname = dirname(fileURLToPath(import.meta.url));
const ART = join(__dirname, "..", "artifacts");

export function groth16ArtifactsReady(): boolean {
  return (
    existsSync(join(ART, "ComplianceGate_final.zkey")) &&
    existsSync(join(ART, "ComplianceGate_js", "ComplianceGate.wasm")) &&
    existsSync(join(ART, "verification_key.json"))
  );
}

/**
 * Prefer groth16 when artifacts exist; otherwise algebraic (holder self-check).
 */
export async function proveComplianceGate(
  witness: ComplianceWitness,
  policy: CompliancePolicy
): Promise<ComplianceGateProof> {
  if (!groth16ArtifactsReady()) {
    return proveComplianceGateAlgebraic(witness, policy);
  }
  const algebraic = proveComplianceGateAlgebraic(witness, policy);
  return { ...algebraic, mode: "groth16", proof: { pending: "wire snarkjs fullProve" } };
}

export async function verifyComplianceGateGroth16(
  _proof: ComplianceGateProof
): Promise<{ ok: boolean; error?: string }> {
  if (!groth16ArtifactsReady()) {
    return { ok: false, error: "groth16 artifacts missing — run build:circuit" };
  }
  return { ok: false, error: "wire snarkjs groth16.verify after ceremony" };
}
