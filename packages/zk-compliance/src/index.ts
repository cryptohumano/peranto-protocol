/**
 * Poseidon claims gate + UltraHonk (Barretenberg) prove/verify.
 */
export {
  honkArtifactsReady,
  honkInputs,
  honkCircuitPublicInputs,
  proveComplianceGateHonk,
  verifyComplianceGateHonk,
} from "./honk.js";
export {
  proveComplianceGateHonkWithCircuit,
  verifyComplianceGateHonkWithCircuit,
} from "./honk-runtime.js";
export type { HonkPackedProof } from "./honk-inputs.js";

import { createRequire } from "node:module";
import type {
  ComplianceGateProof,
  CompliancePolicy,
  ComplianceWitness,
} from "@peranto/sdk";
import { honkArtifactsReady, proveComplianceGateHonk } from "./honk.js";

const require = createRequire(import.meta.url);
const { proveComplianceGateAlgebraic } = require("@peranto/sdk") as typeof import("@peranto/sdk");

/** Prefer UltraHonk when the Noir circuit artifact exists. */
export async function proveComplianceGate(
  witness: ComplianceWitness,
  policy: CompliancePolicy
): Promise<ComplianceGateProof> {
  if (!honkArtifactsReady()) {
    return proveComplianceGateAlgebraic(witness, policy);
  }
  return proveComplianceGateHonk(witness, policy);
}
