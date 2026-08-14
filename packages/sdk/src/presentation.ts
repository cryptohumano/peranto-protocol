/**
 * Peranto presentations — full credential share or selective claims (no JWT).
 *
 * Claims mode: holder discloses a subset of credentialSubject fields and signs
 * challenge+credHash+claims. Verifier checks holder control of DID; issuer
 * binding of those claims requires the full JWT (credential mode) or future SD-JWT/ZKP.
 */
import type { Address, Hex } from "viem";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseDid } from "./did";
import { peekJwtClaims, verifyEcoTestJwt } from "./vc";

export type PresentationMode = "credential" | "claims";

export type PerantoCredentialPresentation = {
  type: "PerantoCredentialPresentation";
  mode: "credential";
  holderDid: string;
  holderAddress: Address;
  challenge: string;
  origin?: string;
  credential: {
    jwt: string;
    credHash: Hex;
    schemaKey: string;
    issuerDid: string;
    subjectDid: string;
    label?: string;
  };
  proof: PresentationProof;
};

export type PerantoClaimsPresentation = {
  type: "PerantoClaimsPresentation";
  mode: "claims";
  holderDid: string;
  holderAddress: Address;
  challenge: string;
  origin?: string;
  /** Commitment to the full JWT kept in the vault (not revealed). */
  credHash: Hex;
  schemaKey: string;
  issuerDid: string;
  subjectDid: string;
  label?: string;
  /** Subset of credentialSubject (no `id`). */
  disclosedClaims: Record<string, unknown>;
  proof: PresentationProof;
};

export type PerantoPresentation =
  | PerantoCredentialPresentation
  | PerantoClaimsPresentation;

export type PresentationProof = {
  type: "EcdsaSecp256k1Signature2019";
  created: string;
  verificationMethod: string;
  challenge: string;
  proofValue: Hex;
  message: string;
};

export type VerifyPresentationResult = {
  ok: boolean;
  mode?: PresentationMode;
  holderDid?: string;
  holderAddress?: Address;
  challenge?: string;
  schemaKey?: string;
  credHash?: Hex;
  /** Claims the verifier may use (from disclose or full JWT subject). */
  claims?: Record<string, unknown>;
  jwtValid?: boolean;
  error?: string;
};

/** Stable JSON for signing (sorted keys, no spaces). */
export function canonicalizeClaims(claims: Record<string, unknown>): string {
  const keys = Object.keys(claims).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = claims[k];
  return JSON.stringify(ordered);
}

export function buildCredentialShareMessage(
  challenge: string,
  credHash: string
): string {
  return `peranto:share:${challenge}:${credHash.toLowerCase()}`;
}

export function buildClaimsShareMessage(
  challenge: string,
  credHash: string,
  disclosedClaims: Record<string, unknown>
): string {
  return `peranto:disclose:${challenge}:${credHash.toLowerCase()}:${canonicalizeClaims(disclosedClaims)}`;
}

export function claimsFromJwt(jwt: string): Record<string, unknown> {
  const peek = peekJwtClaims(jwt);
  return { ...peek.claims };
}

export function pickDisclosedClaims(
  all: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === "id") continue;
    if (Object.prototype.hasOwnProperty.call(all, k)) {
      out[k] = all[k];
    }
  }
  return out;
}

export async function createCredentialPresentation(params: {
  holderPrivateKey: Hex;
  holderDid: string;
  challenge: string;
  origin?: string;
  credential: {
    jwt: string;
    credHash: Hex;
    schemaKey: string;
    issuerDid: string;
    subjectDid: string;
    label?: string;
  };
}): Promise<PerantoCredentialPresentation> {
  const account = privateKeyToAccount(params.holderPrivateKey);
  const message = buildCredentialShareMessage(
    params.challenge,
    params.credential.credHash
  );
  const proofValue = await account.signMessage({ message });
  return {
    type: "PerantoCredentialPresentation",
    mode: "credential",
    holderDid: params.holderDid,
    holderAddress: account.address,
    challenge: params.challenge,
    origin: params.origin,
    credential: params.credential,
    proof: {
      type: "EcdsaSecp256k1Signature2019",
      created: new Date().toISOString(),
      verificationMethod: `${params.holderDid}#controller`,
      challenge: params.challenge,
      proofValue,
      message,
    },
  };
}

export async function createClaimsPresentation(params: {
  holderPrivateKey: Hex;
  holderDid: string;
  challenge: string;
  origin?: string;
  jwt: string;
  credHash: Hex;
  schemaKey: string;
  issuerDid: string;
  subjectDid: string;
  label?: string;
  disclose: string[];
}): Promise<PerantoClaimsPresentation> {
  if (!params.disclose.length) {
    throw new Error("disclose[] vacío — indica qué claims revelar");
  }
  const all = claimsFromJwt(params.jwt);
  const disclosedClaims = pickDisclosedClaims(all, params.disclose);
  const missing = params.disclose.filter(
    (k) => k !== "id" && !Object.prototype.hasOwnProperty.call(disclosedClaims, k)
  );
  if (missing.length) {
    throw new Error(`Claims no disponibles en la VC: ${missing.join(", ")}`);
  }

  const account = privateKeyToAccount(params.holderPrivateKey);
  const message = buildClaimsShareMessage(
    params.challenge,
    params.credHash,
    disclosedClaims
  );
  const proofValue = await account.signMessage({ message });

  return {
    type: "PerantoClaimsPresentation",
    mode: "claims",
    holderDid: params.holderDid,
    holderAddress: account.address,
    challenge: params.challenge,
    origin: params.origin,
    credHash: params.credHash,
    schemaKey: params.schemaKey,
    issuerDid: params.issuerDid,
    subjectDid: params.subjectDid,
    label: params.label,
    disclosedClaims,
    proof: {
      type: "EcdsaSecp256k1Signature2019",
      created: new Date().toISOString(),
      verificationMethod: `${params.holderDid}#controller`,
      challenge: params.challenge,
      proofValue,
      message,
    },
  };
}

export async function verifyPresentation(
  presentation: unknown,
  opts: {
    expectedChallenge?: string;
    expectedOrigin?: string;
    /** If set, holder DID must match. */
    expectedHolderDid?: string;
  } = {}
): Promise<VerifyPresentationResult> {
  if (!presentation || typeof presentation !== "object") {
    return { ok: false, error: "Presentation inválida" };
  }
  const p = presentation as Record<string, unknown>;
  const mode = (p.mode as PresentationMode | undefined) ??
    (p.type === "PerantoClaimsPresentation" ? "claims" : "credential");

  const holderDid = String(p.holderDid ?? "");
  const challenge = String(p.challenge ?? "");
  const proof = p.proof as PresentationProof | undefined;
  if (!holderDid || !challenge || !proof?.proofValue || !proof.message) {
    return { ok: false, error: "Faltan holderDid / challenge / proof" };
  }

  if (opts.expectedChallenge && opts.expectedChallenge !== challenge) {
    return { ok: false, error: "Challenge no coincide", challenge };
  }
  if (
    opts.expectedOrigin &&
    p.origin &&
    String(p.origin) !== opts.expectedOrigin
  ) {
    return { ok: false, error: "Origin no coincide", challenge };
  }
  if (
    opts.expectedHolderDid &&
    opts.expectedHolderDid.toLowerCase() !== holderDid.toLowerCase()
  ) {
    return { ok: false, error: "Holder DID no esperado", holderDid, challenge };
  }

  let expectedMessage: string;
  let claims: Record<string, unknown> = {};
  let schemaKey = "";
  let credHash = "" as Hex;
  let jwtValid: boolean | undefined;

  if (mode === "claims") {
    const disclosed = (p.disclosedClaims ?? {}) as Record<string, unknown>;
    credHash = String(p.credHash ?? "") as Hex;
    schemaKey = String(p.schemaKey ?? "");
    if (!credHash) return { ok: false, error: "claims presentation sin credHash" };
    expectedMessage = buildClaimsShareMessage(challenge, credHash, disclosed);
    claims = disclosed;
  } else {
    const cred = p.credential as
      | {
          jwt?: string;
          credHash?: Hex;
          schemaKey?: string;
        }
      | undefined;
    if (!cred?.jwt || !cred.credHash) {
      return { ok: false, error: "credential presentation sin jwt/credHash" };
    }
    credHash = cred.credHash;
    schemaKey = String(cred.schemaKey ?? "");
    expectedMessage = buildCredentialShareMessage(challenge, cred.credHash);
    const jwtCheck = await verifyEcoTestJwt(cred.jwt);
    jwtValid = jwtCheck.valid;
    if (!jwtCheck.valid) {
      return {
        ok: false,
        mode,
        error: jwtCheck.error ?? "JWT inválido",
        challenge,
        holderDid,
      };
    }
    claims = claimsFromJwt(cred.jwt);
    if (jwtCheck.subjectDid.toLowerCase() !== holderDid.toLowerCase()) {
      // Allow if subject matches holder — otherwise warn
      if (
        jwtCheck.subjectDid.toLowerCase() !==
        String(
          (p.credential as { subjectDid?: string })?.subjectDid ?? ""
        ).toLowerCase()
      ) {
        /* keep */
      }
    }
  }

  if (proof.message !== expectedMessage) {
    return {
      ok: false,
      mode,
      error: "proof.message no coincide con el payload canónico",
      challenge,
      holderDid,
    };
  }

  let recovered: Address;
  try {
    recovered = await recoverMessageAddress({
      message: expectedMessage,
      signature: proof.proofValue,
    });
  } catch (e) {
    return {
      ok: false,
      mode,
      error: e instanceof Error ? e.message : "Firma inválida",
      challenge,
      holderDid,
    };
  }

  const { address: holderAddr } = parseDid(holderDid);
  if (recovered.toLowerCase() !== holderAddr.toLowerCase()) {
    return {
      ok: false,
      mode,
      error: "La firma no corresponde al holderDid",
      holderDid,
      holderAddress: recovered,
      challenge,
    };
  }

  if (p.holderAddress) {
    const ha = String(p.holderAddress).toLowerCase();
    if (ha !== recovered.toLowerCase()) {
      return {
        ok: false,
        mode,
        error: "holderAddress no coincide con la firma",
        challenge,
      };
    }
  }

  return {
    ok: true,
    mode,
    holderDid,
    holderAddress: recovered,
    challenge,
    schemaKey,
    credHash,
    claims,
    jwtValid,
  };
}
