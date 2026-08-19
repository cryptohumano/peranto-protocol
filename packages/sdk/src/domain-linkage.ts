/**
 * DIF Well-Known DID Configuration — Peranto profile.
 * Spec: docs/well-known-did-configuration.md
 */
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  parseDid,
  type DidDocument,
  type PerantoNetwork,
} from "./did";
import { SCHEMA_KEYS } from "./schemas";
import {
  issueJwtCredential,
  peekJwtClaims,
  verifyEcoTestJwt,
  type IssuedCredential,
} from "./vc";

const DIF_WK_CONTEXT =
  "https://identity.foundation/.well-known/did-configuration/v1";
const VC_CONTEXT = "https://www.w3.org/2018/credentials/v1";

export type DidConfigurationDocument = {
  "@context": string | string[];
  linked_dids: Array<string | DomainLinkageEntry>;
};

export type DomainLinkageEntry = {
  "@context"?: string | string[];
  type?: string | string[];
  issuer?: string;
  issuanceDate?: string;
  expirationDate?: string;
  credentialSubject?: {
    id?: string;
    origin?: string;
  };
  proof?: {
    type?: string;
    jwt?: string;
  };
};

export type DomainLinkageVerifyResult = {
  ok: boolean;
  pageOrigin: string;
  issuerDid?: string;
  origin?: string;
  jwt?: string;
  linkedDomainsOnDid?: string[];
  /** True when on-chain LinkedDomains exists but does not list this origin (hint mismatch). */
  linkedDomainsMismatch?: boolean;
  error?: string;
};

/** Normalize to `scheme://host[:port]` (URL.origin). Rejects non-http(s). */
export function normalizeOrigin(input: string): string | null {
  try {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host === "::1"
    );
  } catch {
    return false;
  }
}

/**
 * Strict origin equality after normalize.
 * Non-localhost MUST use https unless `allowHttp` is true.
 */
export function originsMatch(
  a: string,
  b: string,
  opts?: { allowHttp?: boolean }
): boolean {
  const na = normalizeOrigin(a);
  const nb = normalizeOrigin(b);
  if (!na || !nb) return false;
  if (na !== nb) return false;
  const allowHttp = opts?.allowHttp === true;
  if (!allowHttp && !isLocalhostOrigin(na)) {
    try {
      if (new URL(na).protocol !== "https:") return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Extract secp256k1 addresses from assertionMethod VMs (+ controller). */
export function assertionSignerAddressesFromDidDocument(
  doc: DidDocument
): Address[] {
  const out = new Set<string>();
  try {
    out.add(parseDid(doc.id).address.toLowerCase());
  } catch {
    /* ignore */
  }
  for (const vmId of doc.assertionMethod ?? []) {
    const vm = doc.verificationMethod.find((v) => v.id === vmId);
    const m = vm?.blockchainAccountId
      ? /eip155:\d+:(0x[a-fA-F0-9]{40})/i.exec(vm.blockchainAccountId)
      : null;
    if (m?.[1]) out.add(m[1].toLowerCase());
  }
  return [...out] as Address[];
}

/** Origins listed on LinkedDomains services in the DID Document. */
export function linkedDomainOriginsFromDidDocument(doc: DidDocument): string[] {
  const origins: string[] = [];
  for (const svc of doc.service ?? []) {
    const t = String(svc.type ?? "");
    if (t !== "LinkedDomains" && t !== "LinkedDomain") continue;
    const ep = svc.serviceEndpoint;
    const list = Array.isArray(ep) ? ep : [ep];
    for (const item of list) {
      if (typeof item !== "string") continue;
      const n = normalizeOrigin(item);
      if (n) origins.push(n);
    }
  }
  return origins;
}

/**
 * Self-issued DomainLinkageCredential (JWT-VC ES256K).
 * Subject DID = issuer DID. Claim: `origin`.
 */
export async function issueDomainLinkageCredential(params: {
  issuerPrivateKey: Hex;
  network: PerantoNetwork;
  origin: string;
  /** Controller DID address when signing with a purpose assertion key. */
  issuerDidAddress?: Address;
  kid?: string;
}): Promise<IssuedCredential & { origin: string }> {
  const origin = normalizeOrigin(params.origin);
  if (!origin) {
    throw new Error("Invalid origin for DomainLinkageCredential");
  }
  const signer = privateKeyToAccount(params.issuerPrivateKey);
  const didAddress = params.issuerDidAddress ?? signer.address;
  const issued = await issueJwtCredential({
    issuerPrivateKey: params.issuerPrivateKey,
    issuerDidAddress: didAddress,
    kid: params.kid,
    network: params.network,
    subjectAddress: didAddress,
    claims: { origin },
    schemaKey: SCHEMA_KEYS.DomainLinkage,
    credentialType: "DomainLinkageCredential",
  });
  return { ...issued, origin };
}

/** Build DIF `did-configuration.json` body from linkage JWT(s). */
export function buildDidConfiguration(
  entries: Array<{
    jwt: string;
    issuerDid: string;
    origin: string;
    issuanceDate?: string;
    expirationDate?: string;
  }>
): DidConfigurationDocument {
  return {
    "@context": DIF_WK_CONTEXT,
    linked_dids: entries.map((e) => ({
      "@context": [VC_CONTEXT, DIF_WK_CONTEXT],
      type: ["VerifiableCredential", "DomainLinkageCredential"],
      issuer: e.issuerDid,
      issuanceDate: e.issuanceDate ?? new Date().toISOString(),
      ...(e.expirationDate ? { expirationDate: e.expirationDate } : {}),
      credentialSubject: {
        id: e.issuerDid,
        origin: e.origin,
      },
      proof: {
        type: "JwtProof2020",
        jwt: e.jwt,
      },
    })),
  };
}

export function extractLinkageJwts(
  doc: DidConfigurationDocument
): Array<{ jwt: string; entry?: DomainLinkageEntry }> {
  const out: Array<{ jwt: string; entry?: DomainLinkageEntry }> = [];
  for (const item of doc.linked_dids ?? []) {
    if (typeof item === "string") {
      out.push({ jwt: item });
      continue;
    }
    const jwt = item.proof?.jwt;
    if (typeof jwt === "string" && jwt.split(".").length === 3) {
      out.push({ jwt, entry: item });
    }
  }
  return out;
}

function typesIncludeDomainLinkage(types: unknown): boolean {
  if (!types) return false;
  const arr = Array.isArray(types) ? types : [types];
  return arr.some((t) => t === "DomainLinkageCredential");
}

function isExpired(expirationDate?: string, jwtExp?: number): boolean {
  const now = Date.now();
  if (typeof jwtExp === "number" && jwtExp * 1000 < now) return true;
  if (expirationDate) {
    const t = Date.parse(expirationDate);
    if (!Number.isNaN(t) && t < now) return true;
  }
  return false;
}

function readJwtExp(jwt: string): number | undefined {
  try {
    const payloadB64 = jwt.split(".")[1]!;
    const padded =
      payloadB64.replace(/-/g, "+").replace(/_/g, "/") +
      "===".slice((payloadB64.length + 3) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verify a single DomainLinkage JWT against the page origin (no network).
 */
export async function verifyDomainLinkageJwt(params: {
  jwt: string;
  pageOrigin: string;
  allowedSignerAddresses?: Address[];
  entryExpirationDate?: string;
  allowHttp?: boolean;
}): Promise<DomainLinkageVerifyResult> {
  const pageOrigin = normalizeOrigin(params.pageOrigin);
  if (!pageOrigin) {
    return {
      ok: false,
      pageOrigin: params.pageOrigin,
      error: "Invalid page origin",
    };
  }
  if (
    !params.allowHttp &&
    !isLocalhostOrigin(pageOrigin) &&
    new URL(pageOrigin).protocol !== "https:"
  ) {
    return {
      ok: false,
      pageOrigin,
      error: "Non-localhost origin must use https",
    };
  }

  const peeked = peekJwtClaims(params.jwt);
  if (!peeked.ok) {
    return { ok: false, pageOrigin, error: peeked.error ?? "Invalid JWT" };
  }
  if (!typesIncludeDomainLinkage(peeked.types)) {
    return {
      ok: false,
      pageOrigin,
      error: "VC type must include DomainLinkageCredential",
    };
  }

  const claimOrigin = peeked.claims.origin;
  if (typeof claimOrigin !== "string") {
    return {
      ok: false,
      pageOrigin,
      error: "Missing credentialSubject.origin",
    };
  }
  if (!originsMatch(claimOrigin, pageOrigin, { allowHttp: params.allowHttp })) {
    return {
      ok: false,
      pageOrigin,
      origin: normalizeOrigin(claimOrigin) ?? claimOrigin,
      issuerDid: peeked.issuerDid,
      error: "credentialSubject.origin does not match page origin",
    };
  }

  if (!peeked.issuerDid || !peeked.subjectDid) {
    return { ok: false, pageOrigin, error: "Missing iss/sub" };
  }
  if (peeked.issuerDid.toLowerCase() !== peeked.subjectDid.toLowerCase()) {
    return {
      ok: false,
      pageOrigin,
      issuerDid: peeked.issuerDid,
      error: "issuer must equal credentialSubject.id (self-issued)",
    };
  }

  if (isExpired(params.entryExpirationDate, readJwtExp(params.jwt))) {
    return {
      ok: false,
      pageOrigin,
      issuerDid: peeked.issuerDid,
      error: "DomainLinkageCredential expired",
    };
  }

  const sig = await verifyEcoTestJwt(
    params.jwt,
    undefined,
    params.allowedSignerAddresses
  );
  if (!sig.valid) {
    return {
      ok: false,
      pageOrigin,
      issuerDid: peeked.issuerDid,
      origin: pageOrigin,
      jwt: params.jwt,
      error: sig.error ?? "Signature verification failed",
    };
  }

  return {
    ok: true,
    pageOrigin,
    issuerDid: peeked.issuerDid,
    origin: pageOrigin,
    jwt: params.jwt,
  };
}

export type VerifyDomainLinkageOptions = {
  /** Pre-fetched did-configuration.json */
  didConfiguration?: DidConfigurationDocument | string;
  /** Override fetch (tests / Aura). Default: global fetch to well-known URL. */
  fetchDidConfiguration?: (
    wellKnownUrl: string
  ) => Promise<DidConfigurationDocument>;
  /** Resolve issuer DID for assertion keys + LinkedDomains hint. */
  resolveDid?: (did: string) => Promise<DidDocument>;
  /** Expected service DID (session). If set, must match issuer. */
  expectedDid?: string;
  allowHttp?: boolean;
  /**
   * Subpath prefix when the app is not at the origin root (GitHub Pages project
   * sites, Vite `base`, etc.). Example: `/peranto-protocol`.
   */
  wellKnownBasePath?: string;
  /** Browser pathname used to infer a project-site prefix (content scripts). */
  pathname?: string;
};

/** Candidate URLs for DIF well-known, including subpath deployments. */
export function wellKnownDidConfigurationUrls(
  pageOrigin: string,
  opts?: { basePath?: string; pathname?: string }
): string[] {
  const urls: string[] = [];
  const add = (prefix: string) => {
    const base = prefix.replace(/\/+$/, "");
    const url = base
      ? `${pageOrigin}${base}/.well-known/did-configuration.json`
      : `${pageOrigin}/.well-known/did-configuration.json`;
    if (!urls.includes(url)) urls.push(url);
  };

  const basePath = opts?.basePath?.trim();
  if (basePath) add(basePath.startsWith("/") ? basePath : `/${basePath}`);

  if (opts?.pathname) {
    const seg = opts.pathname.split("/").filter(Boolean)[0];
    if (seg && !seg.includes(".")) add(`/${seg}`);
  }

  // Origin root last: GitHub project Pages 404s here; still valid for custom domains.
  add("");

  return urls;
}

async function loadDidConfigurationFromWellKnown(
  pageOrigin: string,
  opts: VerifyDomainLinkageOptions
): Promise<DidConfigurationDocument> {
  const urls = wellKnownDidConfigurationUrls(pageOrigin, {
    basePath: opts.wellKnownBasePath,
    pathname: opts.pathname,
  });
  const fetchOne =
    opts.fetchDidConfiguration ??
    (async (url: string) => {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`well-known HTTP ${res.status} (${url})`);
      }
      return (await res.json()) as DidConfigurationDocument;
    });

  let lastError: unknown = new Error("well-known not found");
  for (const url of urls) {
    try {
      return await fetchOne(url);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

/**
 * Full wallet check: load well-known for pageOrigin, verify DomainLinkageCredential.
 */
export async function verifyDomainLinkage(
  pageOriginInput: string,
  opts: VerifyDomainLinkageOptions = {}
): Promise<DomainLinkageVerifyResult> {
  const pageOrigin = normalizeOrigin(pageOriginInput);
  if (!pageOrigin) {
    return {
      ok: false,
      pageOrigin: pageOriginInput,
      error: "Invalid page origin",
    };
  }

  let config: DidConfigurationDocument;
  try {
    if (opts.didConfiguration !== undefined) {
      config =
        typeof opts.didConfiguration === "string"
          ? (JSON.parse(opts.didConfiguration) as DidConfigurationDocument)
          : opts.didConfiguration;
    } else {
      config = await loadDidConfigurationFromWellKnown(pageOrigin, opts);
    }
  } catch (e) {
    return {
      ok: false,
      pageOrigin,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (!Array.isArray(config.linked_dids) || config.linked_dids.length === 0) {
    return {
      ok: false,
      pageOrigin,
      error: "did-configuration.json missing linked_dids",
    };
  }

  const jwts = extractLinkageJwts(config);
  if (!jwts.length) {
    return {
      ok: false,
      pageOrigin,
      error: "No DomainLinkage JWT found in linked_dids",
    };
  }

  let lastError = "No matching DomainLinkageCredential";
  for (const { jwt, entry } of jwts) {
    let allowedSigners: Address[] | undefined;
    let linkedDomainsOnDid: string[] | undefined;
    let deactivated = false;

    const peek = peekJwtClaims(jwt);
    if (peek.issuerDid && opts.resolveDid) {
      try {
        const doc = await opts.resolveDid(peek.issuerDid);
        if (doc.deactivated) deactivated = true;
        allowedSigners = assertionSignerAddressesFromDidDocument(doc);
        linkedDomainsOnDid = linkedDomainOriginsFromDidDocument(doc);
      } catch (e) {
        // Unpublished / unresolvable DID: still verify JWT against controller iss address.
        lastError =
          e instanceof Error ? e.message : "resolveDid failed for issuer";
      }
    }

    if (deactivated) {
      lastError = "Issuer DID is deactivated";
      continue;
    }

    const result = await verifyDomainLinkageJwt({
      jwt,
      pageOrigin,
      allowedSignerAddresses: allowedSigners,
      entryExpirationDate: entry?.expirationDate,
      allowHttp: opts.allowHttp,
    });

    if (!result.ok) {
      lastError = result.error ?? lastError;
      continue;
    }

    if (
      opts.expectedDid &&
      result.issuerDid &&
      opts.expectedDid.toLowerCase() !== result.issuerDid.toLowerCase()
    ) {
      lastError = "Issuer DID does not match expected session DID";
      continue;
    }

    let linkedDomainsMismatch = false;
    if (linkedDomainsOnDid && linkedDomainsOnDid.length > 0) {
      linkedDomainsMismatch = !linkedDomainsOnDid.some((o) =>
        originsMatch(o, pageOrigin, { allowHttp: opts.allowHttp })
      );
    }

    return {
      ...result,
      linkedDomainsOnDid,
      linkedDomainsMismatch,
    };
  }

  return { ok: false, pageOrigin, error: lastError };
}

/** Convenience: issue + wrap as did-configuration.json */
export async function createDidConfigurationForOrigin(params: {
  issuerPrivateKey: Hex;
  network: PerantoNetwork;
  origin: string;
  issuerDidAddress?: Address;
  kid?: string;
  expirationDate?: string;
}): Promise<{
  issued: IssuedCredential & { origin: string };
  didConfiguration: DidConfigurationDocument;
  wellKnownPath: string;
}> {
  const issued = await issueDomainLinkageCredential(params);
  const didConfiguration = buildDidConfiguration([
    {
      jwt: issued.jwt,
      issuerDid: issued.issuerDid,
      origin: issued.origin,
      expirationDate: params.expirationDate,
    },
  ]);
  return {
    issued,
    didConfiguration,
    wellKnownPath: "/.well-known/did-configuration.json",
  };
}
