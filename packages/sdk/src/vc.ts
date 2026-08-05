import {
  type Address,
  type Hex,
  hexToBytes,
  keccak256,
  toBytes,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { formatDid, parseDid, type PerantoNetwork } from "./did";

export type EcoTestClaims = {
  sampleId: string;
  testType: string;
  result: string | number;
  unit: string;
  labName: string;
  testedAt: string;
};

export type IssuedCredential = {
  jwt: string;
  credHash: Hex;
  issuerDid: string;
  subjectDid: string;
  schemaKey: string;
  payload: Record<string, unknown>;
};

/** RFC 4648 base64url — no usar Buffer("base64url"): el polyfill del browser no lo soporta. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded =
    s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  if (typeof atob === "function") {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function utf8ToBase64Url(obj: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

/**
 * JWT ES256K sin `jose` — WebCrypto/extension no soporta secp256k1.
 * Firma SHA-256(header.payload) con secp256k1 compact (r||s).
 */
function signEs256kJwt(
  privateKey: Hex,
  payload: Record<string, unknown>,
  kid?: string
): string {
  const header: Record<string, string> = { alg: "ES256K", typ: "JWT" };
  if (kid) header.kid = kid;
  const h = utf8ToBase64Url(header);
  const p = utf8ToBase64Url(payload);
  const signingInput = new TextEncoder().encode(`${h}.${p}`);
  const msgHash = sha256(signingInput);
  const sig = secp256k1.sign(msgHash, hexToBytes(privateKey)).normalizeS();
  const compact = sig.toCompactRawBytes();
  return `${h}.${p}.${bytesToBase64Url(compact)}`;
}

function publicJwkFromPrivate(privateKey: Hex) {
  const priv = hexToBytes(privateKey);
  const pub = secp256k1.getPublicKey(priv, false);
  return {
    kty: "EC" as const,
    crv: "secp256k1",
    x: bytesToBase64Url(pub.slice(1, 33)),
    y: bytesToBase64Url(pub.slice(33, 65)),
    alg: "ES256K",
  };
}

export type MemberClaims = {
  fullName: string;
  status: string;
  enrolledAt: string;
  channel?: string;
  photoUri?: string;
  photoHash?: string;
  age?: number | string;
  occupation?: string;
  municipality?: string;
  activities?: string | string[];
  phone?: string;
  contributionHint?: string | number;
};

/** Generic JWT-VC (ES256K). Use for Member, CommonsWork, Care, or arbitrary schemas. */
export async function issueJwtCredential(params: {
  issuerPrivateKey: Hex;
  network: PerantoNetwork;
  subjectAddress: Address;
  claims: Record<string, unknown>;
  schemaKey: string;
  credentialType?: string;
  /**
   * Controller DID address when signing with a purpose assertion key
   * (iss = controller DID; kid = #key-assertion).
   */
  issuerDidAddress?: Address;
  /** JWT `kid` (e.g. `did:…#key-assertion`). */
  kid?: string;
  credentialStatus?: {
    contractAddress: Address;
    chainId: number;
  };
}): Promise<IssuedCredential> {
  const schemaKey = params.schemaKey;
  const typeName =
    params.credentialType ??
    (schemaKey.includes(":") ? schemaKey.split(":")[1]! : "Credential");
  const signer = privateKeyToAccount(params.issuerPrivateKey);
  const didAddress = params.issuerDidAddress ?? signer.address;
  const issuerDid = formatDid(params.network, didAddress);
  const subjectDid = formatDid(params.network, params.subjectAddress);

  const vc: Record<string, unknown> = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", typeName],
    issuer: issuerDid,
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: subjectDid,
      ...params.claims,
    },
    credentialSchema: {
      id: schemaKey,
      type: "JsonSchema",
    },
  };

  if (params.credentialStatus) {
    vc.credentialStatus = {
      id: `${params.credentialStatus.contractAddress}#${schemaKey}`,
      type: "PerantoCredentialStatus2026",
      chainId: params.credentialStatus.chainId,
      contractAddress: params.credentialStatus.contractAddress,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    iss: issuerDid,
    sub: subjectDid,
    iat: now,
    vc,
  };

  const jwt = signEs256kJwt(params.issuerPrivateKey, jwtPayload, params.kid);
  const credHash = keccak256(toBytes(jwt));
  return {
    jwt,
    credHash,
    issuerDid,
    subjectDid,
    schemaKey,
    payload: vc,
  };
}

export async function issueEcoTestCredential(params: {
  issuerPrivateKey: Hex;
  network: PerantoNetwork;
  subjectAddress: Address;
  claims: EcoTestClaims;
  schemaKey?: string;
  credentialStatus?: {
    contractAddress: Address;
    chainId: number;
  };
}): Promise<IssuedCredential> {
  return issueJwtCredential({
    ...params,
    claims: params.claims as unknown as Record<string, unknown>,
    schemaKey: params.schemaKey ?? "peranto:EcoTestResult:v1",
    credentialType: "EcoTestResult",
  });
}

export async function issueMemberCredential(params: {
  issuerPrivateKey: Hex;
  network: PerantoNetwork;
  subjectAddress: Address;
  claims: MemberClaims;
  credentialStatus?: {
    contractAddress: Address;
    chainId: number;
  };
}): Promise<IssuedCredential> {
  return issueJwtCredential({
    ...params,
    claims: params.claims as unknown as Record<string, unknown>,
    schemaKey: "peranto:Member:v1",
    credentialType: "Member",
  });
}

export async function verifyEcoTestJwt(
  jwt: string,
  expectedIssuerAddress?: Address,
  /** Extra secp256k1 addresses allowed to sign (e.g. purpose assertion key). */
  allowedSignerAddresses?: Address[]
): Promise<{
  valid: boolean;
  issuerDid: string;
  subjectDid: string;
  vc: Record<string, unknown>;
  credHash: Hex;
  error?: string;
}> {
  try {
    const [headerB64, payloadB64] = jwt.split(".");
    const header = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(headerB64!))
    ) as { alg?: string; kid?: string };
    if (header.alg !== "ES256K") {
      return {
        valid: false,
        issuerDid: "",
        subjectDid: "",
        vc: {},
        credHash: toHex(new Uint8Array(32)),
        error: "Unsupported alg",
      };
    }

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payloadB64!))
    ) as {
      iss?: string;
      sub?: string;
      vc?: Record<string, unknown>;
    };

    if (!payload.iss || !isLikelyDid(payload.iss)) {
      return emptyFail("Missing issuer");
    }

    const { address: issuerAddress } = parseDid(payload.iss);
    if (
      expectedIssuerAddress &&
      issuerAddress.toLowerCase() !== expectedIssuerAddress.toLowerCase()
    ) {
      return emptyFail("Issuer address mismatch");
    }

    const candidates = [
      issuerAddress,
      ...(allowedSignerAddresses ?? []),
    ];
    const verified = candidates.some((addr) =>
      verifyEs256kAgainstAddress(jwt, addr)
    );
    if (!verified) {
      return {
        valid: false,
        issuerDid: payload.iss,
        subjectDid: payload.sub ?? "",
        vc: payload.vc ?? {},
        credHash: keccak256(toBytes(jwt)),
        error: "Signature verification failed",
      };
    }

    return {
      valid: true,
      issuerDid: payload.iss,
      subjectDid: payload.sub ?? "",
      vc: payload.vc ?? {},
      credHash: keccak256(toBytes(jwt)),
    };
  } catch (e) {
    return emptyFail(e instanceof Error ? e.message : String(e));
  }
}

function isLikelyDid(s: string): boolean {
  return s.startsWith("did:peranto:");
}

/**
 * Decode JWT payload without verifying the signature (for vault UI display).
 * Claims live in `vc.credentialSubject`.
 */
export function peekJwtClaims(jwt: string): {
  ok: boolean;
  issuerDid?: string;
  subjectDid?: string;
  schemaKey?: string;
  types?: string[];
  claims: Record<string, unknown>;
  error?: string;
} {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return { ok: false, claims: {}, error: "JWT malformado" };
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(parts[1]!))
    ) as {
      iss?: string;
      sub?: string;
      vc?: {
        type?: string[];
        credentialSchema?: { id?: string };
        credentialSubject?: Record<string, unknown>;
      };
    };
    const subject = { ...(payload.vc?.credentialSubject ?? {}) };
    delete subject.id;
    return {
      ok: true,
      issuerDid: payload.iss,
      subjectDid: payload.sub,
      schemaKey: payload.vc?.credentialSchema?.id,
      types: payload.vc?.type,
      claims: subject,
    };
  } catch (e) {
    return {
      ok: false,
      claims: {},
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function emptyFail(error: string) {
  return {
    valid: false,
    issuerDid: "",
    subjectDid: "",
    vc: {},
    credHash: ("0x" + "00".repeat(32)) as Hex,
    error,
  };
}

/**
 * Verifica ES256K recuperando la pubkey desde (r,s) y comprobando la address del issuer.
 * No usa jose/WebCrypto (incompatibles con secp256k1 en extensión).
 */
function verifyEs256kAgainstAddress(jwt: string, expected: Address): boolean {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) return false;

  const signingInput = new TextEncoder().encode(`${h}.${p}`);
  const msgHash = sha256(signingInput);

  const sigBytes = base64UrlToBytes(s);
  if (sigBytes.length !== 64) return false;
  const compact = sigBytes;

  for (const recovery of [0, 1]) {
    try {
      const sig = secp256k1.Signature.fromCompact(compact).addRecoveryBit(
        recovery
      );
      const pub = sig.recoverPublicKey(msgHash).toRawBytes(false);
      const addrHash = keccak256(pub.slice(1));
      const addr = ("0x" + addrHash.slice(-40)) as Address;
      if (addr.toLowerCase() === expected.toLowerCase()) {
        // También valida que la firma verifica contra esa pubkey
        if (secp256k1.verify(compact, msgHash, pub)) {
          return true;
        }
      }
    } catch {
      // try next recovery id
    }
  }
  return false;
}

export { publicJwkFromPrivate };
