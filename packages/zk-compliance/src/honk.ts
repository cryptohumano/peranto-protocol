/**
 * UltraHonk prove/verify via Noir + Barretenberg (bb.js) — Node (fs circuit).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ComplianceGateProof,
  CompliancePolicy,
  ComplianceWitness,
} from "@peranto/sdk";
import { proveComplianceGateAlgebraic } from "@peranto/sdk";
import {
  proveComplianceGateHonkWithCircuit,
  verifyComplianceGateHonkWithCircuit,
} from "./honk-runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CIRCUIT_PATH = join(__dirname, "..", "circuit.json");
const SLIM_PATH = join(__dirname, "..", "circuit.slim.json");

export function honkArtifactsReady(): boolean {
  return existsSync(CIRCUIT_PATH) || existsSync(SLIM_PATH);
}

function loadCircuit(): { bytecode: string } {
  const path = existsSync(CIRCUIT_PATH) ? CIRCUIT_PATH : SLIM_PATH;
  return JSON.parse(readFileSync(path, "utf8")) as { bytecode: string };
}

export { honkInputs, honkCircuitPublicInputs } from "./honk-inputs.js";

export async function proveComplianceGateHonk(
  witness: ComplianceWitness,
  policy: CompliancePolicy
): Promise<ComplianceGateProof> {
  if (!honkArtifactsReady()) {
    return proveComplianceGateAlgebraic(witness, policy);
  }
  return proveComplianceGateHonkWithCircuit(loadCircuit(), witness, policy);
}

export async function verifyComplianceGateHonk(
  proof: ComplianceGateProof
): Promise<{ ok: boolean; error?: string }> {
  if (!honkArtifactsReady()) {
    return { ok: false, error: "circuit artifact missing — npm run build:circuit" };
  }
  return verifyComplianceGateHonkWithCircuit(loadCircuit(), proof);
}
