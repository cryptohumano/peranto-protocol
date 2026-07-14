import {
  SignJWT,
  compactVerify,
  importJWK,
  type JWK,
} from "jose";
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

function privateKeyToJwk(privateKey: Hex): JWK {
  const account = privateKeyToAccount(privateKey);
  const priv = hexToBytes(privateKey);
  const pub = secp256k1.getPublicKey(priv, false);
  // uncompressed: 0x04 || x(32) || y(32)
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  return {
    kty: "EC",
    crv: "secp256k1",
    d: Buffer.from(priv).toString("base64url"),
    x: Buffer.from(x).toString("base64url"),
    y: Buffer.from(y).toString("base64url"),
    alg: "ES256K",
  };
}

function publicJwkFromPrivate(privateKey: Hex): JWK {
  const jwk = privateKeyToJwk(privateKey);
  const { d: _d, ...pub } = jwk;
  return pub;
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
  const schemaKey = params.schemaKey ?? "peranto:EcoTestResult:v1";
  const issuer = privateKeyToAccount(params.issuerPrivateKey);
  const issuerDid = formatDid(params.network, issuer.address);
  const subjectDid = formatDid(params.network, params.subjectAddress);

  const vc: Record<string, unknown> = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", "EcoTestResult"],
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

  const key = await importJWK(privateKeyToJwk(params.issuerPrivateKey), "ES256K");
  const jwt = await new SignJWT({ vc })
    .setProtectedHeader({ alg: "ES256K", typ: "JWT" })
    .setIssuer(issuerDid)
    .setSubject(subjectDid)
    .setIssuedAt()
    .sign(key);

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

export async function verifyEcoTestJwt(
  jwt: string,
  expectedIssuerAddress?: Address
): Promise<{
  valid: boolean;
  issuerDid: string;
  subjectDid: string;
  vc: Record<string, unknown>;
  credHash: Hex;
  error?: string;
}> {
  try {
    const [headerB64] = jwt.split(".");
    const header = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf8")
    ) as { alg?: string };
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

    // Decode payload first to get issuer DID → recover expected address
    const payloadB64 = jwt.split(".")[1];
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as {
      iss?: string;
      sub?: string;
      vc?: Record<string, unknown>;
    };

    if (!payload.iss || !isLikelyDid(payload.iss)) {
      return emptyFail("Missing issuer");
    }

    const { address: issuerAddress } = parseDid(payload.iss);
    if (expectedIssuerAddress && issuerAddress.toLowerCase() !== expectedIssuerAddress.toLowerCase()) {
      return emptyFail("Issuer address mismatch");
    }

    // Build JWK from... we need the public key. For ES256K with DID, verify by
    // recovering is harder with jose alone. Re-sign path: extract x,y from signature recovery
    // Simpler approach for MVP: verify JWT structure + recover address via personal techniques.
    // We'll use compactVerify with a public JWK derived if we can recover from signature.

    const verified = await verifyEs256kAgainstAddress(jwt, issuerAddress);
    if (!verified) {
      return emptyFail("Signature verification failed");
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
 * Verify ES256K JWT and check recovered/public key maps to issuer address.
 * Uses jose compactVerify after reconstructing public key from the JWT signature (r,s)
 * via ECDSA public key recovery over the signing input hash.
 */
async function verifyEs256kAgainstAddress(
  jwt: string,
  expected: Address
): Promise<boolean> {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) return false;

  const signingInput = new TextEncoder().encode(`${h}.${p}`);
  const hash = keccak256(signingInput);
  // JWT ES256K uses SHA-256 of signing input, not keccak — jose/ES256K is SHA-256
  const { sha256 } = await import("@noble/hashes/sha256");
  const msgHash = sha256(signingInput);

  const sigBytes = Buffer.from(s, "base64url");
  if (sigBytes.length !== 64) return false;
  const r = sigBytes.subarray(0, 32);
  const ss = sigBytes.subarray(32, 64);

  for (const recovery of [0, 1]) {
    try {
      const sig = secp256k1.Signature.fromCompact(Buffer.concat([r, ss])).addRecoveryBit(
        recovery
      );
      const pub = sig.recoverPublicKey(msgHash).toRawBytes(false);
      const addrHash = keccak256(pub.slice(1));
      const addr = ("0x" + addrHash.slice(-40)) as Address;
      if (addr.toLowerCase() === expected.toLowerCase()) {
        const x = pub.slice(1, 33);
        const y = pub.slice(33, 65);
        const jwk: JWK = {
          kty: "EC",
          crv: "secp256k1",
          x: Buffer.from(x).toString("base64url"),
          y: Buffer.from(y).toString("base64url"),
          alg: "ES256K",
        };
        const key = await importJWK(jwk, "ES256K");
        await compactVerify(jwt, key);
        return true;
      }
    } catch {
      // try next recovery id
    }
  }

  // silence unused
  void hash;
  return false;
}

export { publicJwkFromPrivate };
