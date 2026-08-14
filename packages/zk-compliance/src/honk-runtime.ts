/**
 * UltraHonk prove/verify with an injected circuit (Node or browser).
 */
import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import type {
  ComplianceGateProof,
  CompliancePolicy,
  ComplianceWitness,
} from "@peranto/sdk";
import { proveComplianceGateAlgebraic } from "@peranto/sdk";
import {
  bytesToHex,
  hexToBytes,
  honkInputs,
  type HonkPackedProof,
} from "./honk-inputs.js";

export type CircuitArtifact = { bytecode: string; abi?: unknown };

async function withBackend<T>(
  circuit: CircuitArtifact,
  fn: (backend: UltraHonkBackend) => Promise<T>
): Promise<T> {
  const api = await Barretenberg.new({ threads: 1 });
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  try {
    return await fn(backend);
  } finally {
    await api.destroy();
  }
}

export async function proveComplianceGateHonkWithCircuit(
  circuit: CircuitArtifact,
  witness: ComplianceWitness,
  policy: CompliancePolicy
): Promise<ComplianceGateProof> {
  const algebraic = proveComplianceGateAlgebraic(witness, policy);
  const noir = new Noir(circuit as never);
  const inputs = honkInputs(witness, policy);
  const { witness: solved } = await noir.execute(inputs);
  const proof = await withBackend(circuit, (backend) =>
    backend.generateProof(solved as Uint8Array, { verifierTarget: "evm" })
  );
  return {
    mode: "honk",
    publicSignals: algebraic.publicSignals,
    proof: {
      proof: bytesToHex(proof.proof),
      publicInputs: proof.publicInputs,
    } satisfies HonkPackedProof,
  };
}

export async function verifyComplianceGateHonkWithCircuit(
  circuit: CircuitArtifact,
  proof: ComplianceGateProof
): Promise<{ ok: boolean; error?: string }> {
  if (proof.mode !== "honk" || !proof.proof) {
    return { ok: false, error: "not a honk proof" };
  }
  try {
    const packed = proof.proof as HonkPackedProof;
    const ok = await withBackend(circuit, (backend) =>
      backend.verifyProof(
        {
          proof: hexToBytes(packed.proof),
          publicInputs: packed.publicInputs,
        },
        { verifierTarget: "evm" }
      )
    );
    return ok ? { ok: true } : { ok: false, error: "honk verify failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
