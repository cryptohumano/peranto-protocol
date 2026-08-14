/**
 * Holder flows Sporran-like: Save credential + Share (present) with user consent.
 * Pending state lives in chrome.storage so popup and service worker stay in sync.
 */
import { keccak256, toBytes, type Hex } from "viem";
import {
  peekJwtClaims,
  verifyEcoTestJwt,
  claimsFromJwt,
  createClaimsPresentation,
  createCredentialPresentation,
  SCHEMA_KEYS,
  type PresentationMode,
  type ComplianceGatePublicSignals,
} from "@peranto/sdk";
import * as storage from "./storage";
import type { StoredCredential } from "./types";
import { openAuraConsentWindow } from "./open-consent";

const PENDING_KEY = "aura_pending_holder";
const POLL_MS = 400;
const WAIT_MS = 180_000;

export type PendingSave = {
  kind: "save";
  id: string;
  origin: string;
  jwt: string;
  label?: string;
  schemaKey: string;
  issuerDid: string;
  subjectDid: string;
  credHash: Hex;
  createdAt: string;
};

export type ShareCandidate = {
  id: string;
  credHash: Hex;
  schemaKey: string;
  issuerDid: string;
  subjectDid: string;
  label: string;
  claimKeys: string[];
  /** Local preview for consent UI (not sent to dapp until approved). */
  claimPreview: Record<string, unknown>;
};

export type PendingShare = {
  kind: "share";
  id: string;
  origin: string;
  challenge: string;
  schemaKeys: string[];
  /** credential = full JWT; claims = selective disclose without JWT */
  mode: PresentationMode;
  /** Minimum claim keys the verifier requests (claims mode). */
  disclose: string[];
  trustedIssuers?: string[];
  subject?: string;
  candidates: ShareCandidate[];
  createdAt: string;
};

export type PendingProve = {
  kind: "prove";
  id: string;
  origin: string;
  minScoreBps: number;
  allowlist: string[];
  liveCredHash: Hex;
  resCredHash: Hex;
  createdAt: string;
};

export type HonkHolderResult = {
  mode: "honk";
  liveCredHash: string;
  resCredHash: string;
  publicSignals: unknown;
  proof: { proof: string; publicInputs: string[] };
  note: string;
};

export type PendingHolder = PendingSave | PendingShare | PendingProve;

type PendingRecord =
  | (PendingHolder & { status: "pending" })
  | (PendingHolder & {
      status: "approved";
      selectedCredHash?: string;
      disclosedKeys?: string[];
      result?: HonkHolderResult;
    })
  | (PendingHolder & { status: "rejected"; reason?: string });

function newId(): string {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function setBadge(text: string) {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: "#1a5b92" });
  } catch {
    /* popup / no action */
  }
}

export async function getPendingHolder(): Promise<PendingHolder | null> {
  const raw = await chrome.storage.local.get(PENDING_KEY);
  const rec = raw[PENDING_KEY] as PendingRecord | undefined;
  if (!rec || rec.status !== "pending") return null;
  const { status: _s, ...rest } = rec;
  return rest as PendingHolder;
}

async function writePending(rec: PendingRecord | null) {
  if (!rec) {
    await chrome.storage.local.remove(PENDING_KEY);
    await setBadge("");
    return;
  }
  await chrome.storage.local.set({ [PENDING_KEY]: rec });
  await setBadge(rec.status === "pending" ? "!" : "");
  if (rec.status === "pending") {
    void openAuraConsentWindow();
  }
}

async function waitForResolution(id: string): Promise<PendingRecord> {
  const start = Date.now();
  while (Date.now() - start < WAIT_MS) {
    const raw = await chrome.storage.local.get(PENDING_KEY);
    const rec = raw[PENDING_KEY] as PendingRecord | undefined;
    if (!rec || rec.id !== id) {
      throw new Error("Aura: solicitud holder cancelada");
    }
    if (rec.status === "approved" || rec.status === "rejected") {
      return rec;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await writePending(null);
  throw new Error("Aura: tiempo agotado esperando aprobación en el popup");
}

function schemaFromJwt(jwt: string, fallback?: string): string {
  const peek = peekJwtClaims(jwt);
  return (
    fallback ||
    peek.schemaKey ||
    peek.types?.find((t) => t.startsWith("peranto:")) ||
    "peranto:Unknown:v1"
  );
}

/** dApp offers a JWT-VC → holder confirms → vault. */
export async function beginSaveCredential(opts: {
  origin: string;
  jwt: string;
  label?: string;
  schemaKey?: string;
  meta?: StoredCredential["meta"];
}): Promise<StoredCredential> {
  const jwt = opts.jwt.trim();
  if (!jwt) throw new Error("Aura: jwt requerido");

  // Vault save only needs crypto validity — on-chain status is optional here.
  const verified = await verifyEcoTestJwt(jwt);
  if (!verified.valid) {
    throw new Error(verified.error ?? "JWT inválido");
  }

  const schemaKey = schemaFromJwt(jwt, opts.schemaKey);
  const credHash = verified.credHash;
  const pending: PendingSave = {
    kind: "save",
    id: newId(),
    origin: opts.origin,
    jwt,
    label: opts.label,
    schemaKey,
    issuerDid: verified.issuerDid,
    subjectDid: verified.subjectDid,
    credHash,
    createdAt: new Date().toISOString(),
  };

  await writePending({ ...pending, status: "pending" });

  const resolved = await waitForResolution(pending.id);
  if (resolved.status === "rejected") {
    await writePending(null);
    throw new Error(resolved.reason || "Aura: usuario rechazó guardar la credencial");
  }

  const label =
    pending.label ||
    schemaKey.replace(/^peranto:/, "").replace(/:v\d+$/, "") ||
    "Credencial";

  const meta = opts.meta
    ? {
        claimsCommitment: opts.meta.claimsCommitment,
        commitmentSalt: opts.meta.commitmentSalt,
        validUntil: opts.meta.validUntil,
      }
    : undefined;

  const cred: StoredCredential = {
    id: credHash,
    jwt,
    credHash,
    schemaKey,
    issuerDid: pending.issuerDid,
    subjectDid: pending.subjectDid,
    label,
    savedAt: new Date().toISOString(),
    meta,
  };
  await storage.addCredential(cred);
  await writePending(null);
  return cred;
}

/** Verifier requests credential(s) → holder picks → presentation. */
export async function beginShareCredential(opts: {
  origin: string;
  challenge: string;
  schemaKeys: string[];
  trustedIssuers?: string[];
  subject?: string;
  /** default credential (full JWT). Use "claims" for selective disclose. */
  mode?: PresentationMode;
  /** Required claim keys when mode=claims (e.g. ["country"]). */
  disclose?: string[];
}): Promise<unknown> {
  const challenge = String(opts.challenge ?? "").trim();
  if (!challenge) throw new Error("Aura: challenge requerido");
  const schemaKeys = (opts.schemaKeys ?? []).map(String).filter(Boolean);
  if (!schemaKeys.length) {
    throw new Error("Aura: schemaKeys[] requerido");
  }
  const mode: PresentationMode =
    opts.mode === "claims" ? "claims" : "credential";
  const disclose = (opts.disclose ?? []).map(String).filter(Boolean);
  if (mode === "claims" && !disclose.length) {
    throw new Error("Aura: mode=claims requiere disclose[] (claims a revelar)");
  }

  const state = await storage.getState();
  if (!state.identity) throw new Error("Aura: sin identidad");

  let credentials = state.credentials.filter((c) =>
    schemaKeys.some((k) => k === c.schemaKey || c.schemaKey.includes(k))
  );
  if (opts.trustedIssuers?.length) {
    const set = new Set(opts.trustedIssuers.map((d) => d.toLowerCase()));
    credentials = credentials.filter((c) => set.has(c.issuerDid.toLowerCase()));
  }
  if (opts.subject) {
    const sub = opts.subject.toLowerCase();
    credentials = credentials.filter((c) => c.subjectDid.toLowerCase() === sub);
  }
  if (mode === "claims") {
    credentials = credentials.filter((c) => {
      const claims = claimsFromJwt(c.jwt);
      return disclose.every((k) => Object.prototype.hasOwnProperty.call(claims, k));
    });
  }

  const pending: PendingShare = {
    kind: "share",
    id: newId(),
    origin: opts.origin,
    challenge,
    schemaKeys,
    mode,
    disclose,
    trustedIssuers: opts.trustedIssuers,
    subject: opts.subject,
    candidates: credentials.map((c) => {
      const claimPreview = claimsFromJwt(c.jwt);
      return {
        id: c.id,
        credHash: c.credHash,
        schemaKey: c.schemaKey,
        issuerDid: c.issuerDid,
        subjectDid: c.subjectDid,
        label: c.label,
        claimKeys: Object.keys(claimPreview),
        claimPreview,
      };
    }),
    createdAt: new Date().toISOString(),
  };

  await writePending({ ...pending, status: "pending" });

  const resolved = await waitForResolution(pending.id);
  if (resolved.status === "rejected") {
    await writePending(null);
    throw new Error(resolved.reason || "Aura: usuario rechazó compartir");
  }

  if (pending.candidates.length === 0) {
    await writePending(null);
    throw new Error("Aura: no hay credenciales que coincidan con la solicitud");
  }

  const selectedHash =
    (resolved as PendingRecord & { selectedCredHash?: string }).selectedCredHash ||
    pending.candidates[0]!.credHash;
  const disclosedKeys =
    (resolved as PendingRecord & { disclosedKeys?: string[] }).disclosedKeys ??
    disclose;

  const cred = state.credentials.find(
    (c) => c.credHash.toLowerCase() === String(selectedHash).toLowerCase()
  );
  if (!cred) {
    await writePending(null);
    throw new Error("Aura: credencial seleccionada no encontrada");
  }

  const holderDid = state.identity.did;
  const holderPrivateKey = state.identity.privateKey;

  let presentation: unknown;
  if (mode === "claims") {
    presentation = await createClaimsPresentation({
      holderPrivateKey,
      holderDid,
      challenge,
      origin: opts.origin,
      jwt: cred.jwt,
      credHash: cred.credHash,
      schemaKey: cred.schemaKey,
      issuerDid: cred.issuerDid,
      subjectDid: cred.subjectDid,
      label: cred.label,
      disclose: disclosedKeys.length ? disclosedKeys : disclose,
    });
  } else {
    presentation = await createCredentialPresentation({
      holderPrivateKey,
      holderDid,
      challenge,
      origin: opts.origin,
      credential: {
        jwt: cred.jwt,
        credHash: cred.credHash,
        schemaKey: cred.schemaKey,
        issuerDid: cred.issuerDid,
        subjectDid: cred.subjectDid,
        label: cred.label,
      },
    });
  }

  await writePending(null);
  return presentation;
}

/**
 * Build compliance ZK publicSignals inside the wallet (salt never leaves Aura).
 * User confirms in popup; dapp only receives publicSignals + credHashes.
 */
export async function beginProveComplianceGate(opts: {
  origin: string;
  minScoreBps: number;
  allowlist: string[];
}): Promise<{
  mode: "honk";
  liveCredHash: Hex;
  resCredHash: Hex;
  publicSignals: ComplianceGatePublicSignals;
  proof: { proof: string; publicInputs: string[] };
  note: string;
}> {
  const state = await storage.getState();
  if (!state.identity) throw new Error("Aura: sin identidad");

  const live = state.credentials.find(
    (c) =>
      c.schemaKey === SCHEMA_KEYS.LivenessCheck ||
      c.schemaKey.includes("LivenessCheck")
  );
  const residence = state.credentials.find(
    (c) =>
      c.schemaKey === SCHEMA_KEYS.ProofOfResidence ||
      c.schemaKey.includes("ProofOfResidence")
  );
  if (!live || !residence) {
    throw new Error(
      "Aura: necesitas Liveness + ProofOfResidence en el vault para prueba ZK"
    );
  }
  if (!live.meta?.commitmentSalt || !live.meta?.claimsCommitment) {
    throw new Error(
      "Aura: Liveness sin salt — vuelve a Guardar desde el attester (meta commitmentSalt)"
    );
  }
  if (!residence.meta?.commitmentSalt || !residence.meta?.claimsCommitment) {
    throw new Error(
      "Aura: Residence sin salt — vuelve a Guardar desde el attester (meta commitmentSalt)"
    );
  }

  const pending: PendingProve = {
    kind: "prove",
    id: newId(),
    origin: opts.origin,
    minScoreBps: opts.minScoreBps,
    allowlist: opts.allowlist,
    liveCredHash: live.credHash,
    resCredHash: residence.credHash,
    createdAt: new Date().toISOString(),
  };
  await writePending({ ...pending, status: "pending" });
  const resolved = await waitForResolution(pending.id);
  if (resolved.status === "rejected") {
    await writePending(null);
    throw new Error(resolved.reason || "Aura: usuario rechazó la prueba ZK");
  }

  const honk =
    resolved.status === "approved" ? resolved.result : undefined;
  if (!honk || honk.mode !== "honk" || !honk.proof) {
    await writePending(null);
    throw new Error(
      "Aura: no hay prueba Honk — recarga la extensión y pulsa Generar en el popup (Noir/bb.js)"
    );
  }

  await writePending(null);
  console.info("[Aura] compliance prove = UltraHonk (Noir circuit in popup)", {
    mode: honk.mode,
    liveCredHash: live.credHash,
    resCredHash: residence.credHash,
  });
  return {
    mode: "honk",
    liveCredHash: live.credHash,
    resCredHash: residence.credHash,
    publicSignals: honk.publicSignals as ComplianceGatePublicSignals,
    proof: honk.proof,
    note: honk.note,
  };
}

export async function approvePendingProve(): Promise<void> {
  const raw = await chrome.storage.local.get(PENDING_KEY);
  const rec = raw[PENDING_KEY] as PendingRecord | undefined;
  if (!rec || rec.kind !== "prove" || rec.status !== "pending") {
    throw new Error("No hay solicitud de prueba ZK pendiente");
  }
  if (typeof document === "undefined") {
    throw new Error(
      "La prueba Honk debe generarse en la ventana de Aura, no en el service worker"
    );
  }
  const { proveHonkForPending } = await import("./honk-prove");
  const result = await proveHonkForPending(rec);
  await writePending({ ...rec, status: "approved", result });
}

export async function approvePendingSave(): Promise<void> {
  const raw = await chrome.storage.local.get(PENDING_KEY);
  const rec = raw[PENDING_KEY] as PendingRecord | undefined;
  if (!rec || rec.kind !== "save" || rec.status !== "pending") {
    throw new Error("No hay solicitud de guardado pendiente");
  }
  await writePending({ ...rec, status: "approved" });
}

export async function approvePendingShare(
  credHash: string,
  disclosedKeys?: string[]
): Promise<void> {
  const raw = await chrome.storage.local.get(PENDING_KEY);
  const rec = raw[PENDING_KEY] as PendingRecord | undefined;
  if (!rec || rec.kind !== "share" || rec.status !== "pending") {
    throw new Error("No hay solicitud de compartir pendiente");
  }
  if (rec.candidates.length > 0) {
    const ok = rec.candidates.some(
      (c) => c.credHash.toLowerCase() === credHash.toLowerCase()
    );
    if (!ok) throw new Error("Credencial no está en los candidatos");
  }
  if (rec.mode === "claims") {
    const keys = disclosedKeys?.length ? disclosedKeys : rec.disclose;
    for (const req of rec.disclose) {
      if (!keys.includes(req)) {
        throw new Error(`Debes revelar el claim requerido: ${req}`);
      }
    }
    await writePending({
      ...rec,
      status: "approved",
      selectedCredHash: credHash,
      disclosedKeys: keys,
    });
    return;
  }
  await writePending({
    ...rec,
    status: "approved",
    selectedCredHash: credHash,
  });
}

export async function rejectPendingHolder(reason?: string): Promise<void> {
  const raw = await chrome.storage.local.get(PENDING_KEY);
  const rec = raw[PENDING_KEY] as PendingRecord | undefined;
  if (!rec || rec.status !== "pending") {
    await writePending(null);
    return;
  }
  await writePending({
    ...rec,
    status: "rejected",
    reason: reason || "rejected",
  });
  // brief delay so waiter can read, then cleaner may clear
  setTimeout(() => {
    void chrome.storage.local.get(PENDING_KEY).then((r) => {
      const cur = r[PENDING_KEY] as PendingRecord | undefined;
      if (cur && cur.status !== "pending") {
        void chrome.storage.local.remove(PENDING_KEY);
        void setBadge("");
      }
    });
  }, 1500);
}

/** Helper for tests / credHash from jwt without full verify. */
export function hashJwt(jwt: string): Hex {
  return keccak256(toBytes(jwt));
}
