/**
 * UltraHonk prove inside the Aura UI (popup / consent window).
 * Must not run in the MV3 service worker — bb.js needs WASM + DOM/IndexedDB.
 */
import type { Address } from "viem";
import {
  claimsFromJwt,
  expiresAtToUnix,
  parseDid,
  scoreToBps,
} from "@peranto/sdk";
import { proveComplianceGateHonkWithCircuit } from "../../../zk-compliance/src/honk-runtime";
import type { PendingProve } from "./holder-flow";
import * as storage from "./storage";
import circuit from "@peranto/circuit";

export type HonkProveResult = {
  mode: "honk";
  liveCredHash: string;
  resCredHash: string;
  publicSignals: {
    liveCommitment: string;
    resCommitment: string;
    minScoreBps: number;
    allowlistRoot: string;
    now: number;
    liveCredHash: string;
    resCredHash: string;
  };
  proof: { proof: string; publicInputs: string[] };
  note: string;
};

export async function proveHonkForPending(
  rec: PendingProve
): Promise<HonkProveResult> {
  const state = await storage.getState();
  if (!state.identity) throw new Error("Aura: sin identidad");
  const live = state.credentials.find(
    (c) => c.credHash.toLowerCase() === rec.liveCredHash.toLowerCase()
  );
  const residence = state.credentials.find(
    (c) => c.credHash.toLowerCase() === rec.resCredHash.toLowerCase()
  );
  if (!live || !residence) {
    throw new Error("Aura: credenciales de la prueba ya no están en el vault");
  }
  if (!live.meta?.commitmentSalt || !live.meta?.claimsCommitment) {
    throw new Error("Aura: Liveness sin salt — vuelve a Guardar desde el attester");
  }
  if (!residence.meta?.commitmentSalt || !residence.meta?.claimsCommitment) {
    throw new Error("Aura: Residence sin salt — vuelve a Guardar desde el attester");
  }

  const liveClaims = claimsFromJwt(live.jwt);
  const resClaims = claimsFromJwt(residence.jwt);
  const { address: subject } = parseDid(state.identity.did);
  const now = Math.floor(Date.now() / 1000);
  const score = Number(liveClaims.score ?? liveClaims.livenessScore ?? 0);
  const country = String(resClaims.country ?? "");
  const liveExp = expiresAtToUnix(
    String(liveClaims.expiresAt ?? live.meta.validUntil ?? now)
  );
  const resExp = expiresAtToUnix(
    String(resClaims.expiresAt ?? residence.meta.validUntil ?? now)
  );

  const proved = await proveComplianceGateHonkWithCircuit(
    circuit,
    {
      live: {
        scoreBps: scoreToBps(score),
        expiresAtUnix: liveExp,
        subject: subject as Address,
        salt: live.meta.commitmentSalt,
        commitment: live.meta.claimsCommitment,
        credHash: live.credHash,
      },
      residence: {
        country,
        expiresAtUnix: resExp,
        subject: subject as Address,
        salt: residence.meta.commitmentSalt,
        commitment: residence.meta.claimsCommitment,
        credHash: residence.credHash,
      },
    },
    {
      minScoreBps: rec.minScoreBps,
      allowlist: rec.allowlist,
      now,
    }
  );
  if (proved.mode !== "honk" || !proved.proof) {
    throw new Error("Aura: el circuito Noir no produjo prueba Honk");
  }
  const packed = proved.proof as { proof: string; publicInputs: string[] };
  return {
    mode: "honk",
    liveCredHash: live.credHash,
    resCredHash: residence.credHash,
    publicSignals: proved.publicSignals,
    proof: packed,
    note: "UltraHonk (Noir) — salts never left Aura",
  };
}
