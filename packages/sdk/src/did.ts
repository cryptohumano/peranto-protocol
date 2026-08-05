import {
  type Address,
  type Hex,
  bytesToHex,
  checksumAddress,
  getAddress,
  hexToBytes,
  hexToString,
  isAddress,
  keccak256,
  stringToBytes,
  toBytes,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

export type PerantoNetwork =
  | "hardhat"
  | "localhost"
  | "paseo"
  | "base"
  | "baseSepolia"
  | "arbitrum"
  | "arbitrumSepolia";

export const NETWORK_CHAIN_ID: Record<PerantoNetwork, number> = {
  hardhat: 31337,
  localhost: 31337,
  paseo: 420420417,
  base: 8453,
  baseSepolia: 84532,
  arbitrum: 42161,
  arbitrumSepolia: 421614,
};

export const CHAIN_ID_NETWORK: Record<number, PerantoNetwork> = {
  31337: "hardhat",
  420420417: "paseo",
  8453: "base",
  84532: "baseSepolia",
  42161: "arbitrum",
  421614: "arbitrumSepolia",
};

const DID_RE =
  /^did:peranto:(hardhat|localhost|paseo|base|baseSepolia|arbitrum|arbitrumSepolia):(0x[a-fA-F0-9]{40})$/;

/** Attribute name prefix for DID Document services (ERC-1056 / ethr-did style). */
export const DID_SVC_PREFIX = "did/svc/";

/** Attribute name prefix for purpose verification methods (method v0.2.1). */
export const DID_VM_PREFIX = "did/vm/";

/** Default validity for services (~100 years). Use 0 to expire immediately (clear). */
export const DID_SERVICE_DEFAULT_VALIDITY = 60n * 60n * 24n * 365n * 100n;

export function createIdentity(network: PerantoNetwork = "hardhat"): {
  privateKey: Hex;
  address: Address;
  did: string;
} {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address,
    did: formatDid(network, account.address),
  };
}

export function formatDid(network: PerantoNetwork, address: Address): string {
  return `did:peranto:${network}:${getAddress(address)}`;
}

export function parseDid(did: string): {
  network: PerantoNetwork;
  address: Address;
} {
  const m = DID_RE.exec(did);
  if (!m) {
    throw new Error(`Invalid did:peranto: ${did}`);
  }
  return {
    network: m[1] as PerantoNetwork,
    address: getAddress(m[2] as Address),
  };
}

export function isPerantoDid(did: string): boolean {
  return DID_RE.test(did);
}

export type DidService = {
  id: string;
  type: string;
  serviceEndpoint: string | string[] | Record<string, unknown>;
  /**
   * Suffix after `did/svc/` used as on-chain attribute name
   * (e.g. `LinkedDomains` or `LinkedDomains.github`).
   */
  attrKey?: string;
  /** Optional display label (linktr33 tag). */
  name?: string;
};

export type DidDocument = {
  "@context": string[];
  id: string;
  controller: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    blockchainAccountId?: string;
    publicKeyJwk?: {
      kty: string;
      crv?: string;
      x?: string;
      y?: string;
      [k: string]: unknown;
    };
    publicKeyMultibase?: string;
  }>;
  authentication: string[];
  assertionMethod: string[];
  /** Peranto v0.2.1: X25519 purpose key when published. */
  keyAgreement?: string[];
  /** Peranto v0.2: `svc` delegates (may update did/svc/* on-chain). */
  capabilityInvocation?: string[];
  service?: DidService[];
  deactivated?: boolean;
};

/** On-chain delegate type bytes32 (UTF-8 left-aligned). */
export const DELEGATE_TYPE_SVC = "svc";
export const DELEGATE_TYPE_SIG_AUTH = "sigAuth";
export const DELEGATE_TYPE_VERI_KEY = "veriKey";

export type DidDelegate = {
  delegateType: string;
  address: Address;
  validTo: number;
};

export function delegateTypeToBytes32(type: string): Hex {
  return attributeNameToBytes32(type.trim());
}

export function delegateTypeFromBytes32(name: Hex): string {
  return attributeNameFromBytes32(name);
}

/**
 * Encode a short ASCII attribute name as bytes32 (right-padded), ERC-1056 style.
 * Max 32 bytes UTF-8.
 */
export function attributeNameToBytes32(name: string): Hex {
  const bytes = stringToBytes(name);
  if (bytes.length === 0 || bytes.length > 32) {
    throw new Error(`Attribute name length must be 1..32 bytes (got ${bytes.length})`);
  }
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return bytesToHex(padded);
}

export function attributeNameFromBytes32(name: Hex): string {
  const raw = hexToBytes(name);
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end--;
  return new TextDecoder().decode(raw.slice(0, end));
}

/**
 * Attribute key for a DID service.
 * - `LinkedDomains` → `did/svc/LinkedDomains`
 * - type + key `github` → `did/svc/LinkedDomains.github` (varios del mismo tipo)
 */
export function serviceAttributeName(serviceType: string, key?: string): Hex {
  const t = serviceType.trim().replace(/[./]/g, "");
  if (!t) throw new Error("serviceType requerido");
  const k = (key ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  const full = k ? `${DID_SVC_PREFIX}${t}.${k}` : `${DID_SVC_PREFIX}${t}`;
  return attributeNameToBytes32(full);
}

export function isServiceAttributeName(name: string): boolean {
  return name.startsWith(DID_SVC_PREFIX) && name.length > DID_SVC_PREFIX.length;
}

/** Returns the attrKey after `did/svc/` (may include `.slot`). */
export function serviceAttrKeyFromAttributeName(name: string): string {
  return name.slice(DID_SVC_PREFIX.length);
}

/** Public type label (strips `.slot`). */
export function serviceTypeFromAttributeName(name: string): string {
  const key = serviceAttrKeyFromAttributeName(name);
  const dot = key.indexOf(".");
  return dot === -1 ? key : key.slice(0, dot);
}

export function serviceSlotFromAttributeName(name: string): string | undefined {
  const key = serviceAttrKeyFromAttributeName(name);
  const dot = key.indexOf(".");
  return dot === -1 ? undefined : key.slice(dot + 1);
}

export type DidVmRelationship =
  | "authentication"
  | "assertionMethod"
  | "keyAgreement";

/** On-chain purpose VM decoded from `did/vm/*` attributes. */
export type DidPurposeVm = {
  relationship: DidVmRelationship;
  id: string;
  type: string;
  blockchainAccountId?: string;
  publicKeyJwk?: DidDocument["verificationMethod"][number]["publicKeyJwk"];
  publicKeyMultibase?: string;
};

const VM_RELATIONSHIPS: DidVmRelationship[] = [
  "authentication",
  "assertionMethod",
  "keyAgreement",
];

export function vmAttributeName(relationship: DidVmRelationship): Hex {
  return attributeNameToBytes32(`${DID_VM_PREFIX}${relationship}`);
}

export function isVmAttributeName(name: string): boolean {
  return name.startsWith(DID_VM_PREFIX) && name.length > DID_VM_PREFIX.length;
}

export function vmRelationshipFromAttributeName(
  name: string
): DidVmRelationship | null {
  const rel = name.slice(DID_VM_PREFIX.length);
  return VM_RELATIONSHIPS.includes(rel as DidVmRelationship)
    ? (rel as DidVmRelationship)
    : null;
}

export function encodeDidPurposeVmValue(vm: {
  id: string;
  type: string;
  blockchainAccountId?: string;
  publicKeyJwk?: DidPurposeVm["publicKeyJwk"];
  publicKeyMultibase?: string;
}): Hex {
  const body: Record<string, unknown> = {
    id: vm.id,
    type: vm.type,
  };
  if (vm.blockchainAccountId) body.blockchainAccountId = vm.blockchainAccountId;
  if (vm.publicKeyJwk) body.publicKeyJwk = vm.publicKeyJwk;
  if (vm.publicKeyMultibase) body.publicKeyMultibase = vm.publicKeyMultibase;
  return bytesToHex(stringToBytes(JSON.stringify(body)));
}

export function decodeDidPurposeVmValue(
  value: Hex,
  relationship: DidVmRelationship,
  did: string
): DidPurposeVm | null {
  if (!value || value === "0x") return null;
  try {
    const text = hexToString(value);
    const parsed = JSON.parse(text) as Partial<DidPurposeVm>;
    const id =
      typeof parsed.id === "string" && parsed.id
        ? parsed.id
        : `${did}#key-${relationship === "assertionMethod" ? "assertion" : relationship === "authentication" ? "authentication" : "agreement"}`;
    const type =
      typeof parsed.type === "string" && parsed.type
        ? parsed.type
        : relationship === "keyAgreement"
          ? "X25519KeyAgreementKey2020"
          : "EcdsaSecp256k1RecoveryMethod2020";
    const out: DidPurposeVm = { relationship, id, type };
    if (typeof parsed.blockchainAccountId === "string") {
      out.blockchainAccountId = parsed.blockchainAccountId;
    }
    if (parsed.publicKeyJwk && typeof parsed.publicKeyJwk === "object") {
      out.publicKeyJwk = parsed.publicKeyJwk;
    }
    if (typeof parsed.publicKeyMultibase === "string") {
      out.publicKeyMultibase = parsed.publicKeyMultibase;
    }
    if (!out.blockchainAccountId && !out.publicKeyJwk && !out.publicKeyMultibase) {
      return null;
    }
    return out;
  } catch {
    return null;
  }
}

/** Encode service payload for `DIDRegistry.setAttribute` value. */
export function encodeDidServiceValue(service: {
  id?: string;
  type: string;
  serviceEndpoint: string | string[] | Record<string, unknown>;
  name?: string;
}): Hex {
  const body: Record<string, unknown> = {
    id: service.id,
    type: service.type,
    serviceEndpoint: service.serviceEndpoint,
  };
  if (service.name?.trim()) body.name = service.name.trim().slice(0, 48);
  return bytesToHex(stringToBytes(JSON.stringify(body)));
}

export function decodeDidServiceValue(
  value: Hex,
  fallbackType: string,
  did: string
): DidService | null {
  if (!value || value === "0x") return null;
  try {
    const text = hexToString(value);
    const parsed = JSON.parse(text) as Partial<DidService> & {
      name?: string;
    };
    if (!parsed.serviceEndpoint) return null;
    return {
      id: parsed.id ?? `${did}#service-${fallbackType}`,
      type: parsed.type ?? fallbackType,
      serviceEndpoint: parsed.serviceEndpoint,
      name:
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim().slice(0, 48)
          : undefined,
    };
  } catch {
    // Plain UTF-8 endpoint string
    try {
      const endpoint = hexToString(value);
      if (!endpoint) return null;
      return {
        id: `${did}#service-${fallbackType}`,
        type: fallbackType,
        serviceEndpoint: endpoint,
      };
    } catch {
      return null;
    }
  }
}

/** Minimal / implicit resolve (no chain reads). Enriched resolve is via PerantoClient.resolveDid. */
/**
 * Build a DID Document from controller + optional services, delegates, and purpose VMs.
 * Method v0.2: `sigAuth` → authentication, `veriKey` → assertionMethod,
 * `svc` → capabilityInvocation.
 * Method v0.2.1: `did/vm/*` purpose keys override/enrich authentication, assertionMethod, keyAgreement.
 */
export function resolveDidDocument(
  did: string,
  deactivated = false,
  services?: DidService[],
  delegates?: DidDelegate[],
  purposeVms?: DidPurposeVm[]
): DidDocument {
  const { network, address } = parseDid(did);
  const chainId = NETWORK_CHAIN_ID[network];
  const vmId = `${did}#controller`;
  const verificationMethod: DidDocument["verificationMethod"] = [
    {
      id: vmId,
      type: "EcdsaSecp256k1RecoveryMethod2020",
      controller: did,
      blockchainAccountId: `eip155:${chainId}:${checksumAddress(address)}`,
    },
  ];
  const authentication: string[] = [vmId];
  let assertionMethod: string[] = [vmId];
  const capabilityInvocation: string[] = [];
  const keyAgreement: string[] = [];

  const now = Math.floor(Date.now() / 1000);
  for (const d of delegates ?? []) {
    if (d.validTo <= now) continue;
    const type = d.delegateType.trim();
    const frag =
      type === DELEGATE_TYPE_SIG_AUTH
        ? "sigAuth"
        : type === DELEGATE_TYPE_VERI_KEY
          ? "veriKey"
          : type === DELEGATE_TYPE_SVC
            ? "svc"
            : type.replace(/[^a-zA-Z0-9_-]/g, "") || "delegate";
    const id = `${did}#delegate-${frag}-${d.address.toLowerCase().slice(2, 10)}`;
    if (!verificationMethod.some((vm) => vm.id === id)) {
      verificationMethod.push({
        id,
        type: "EcdsaSecp256k1RecoveryMethod2020",
        controller: did,
        blockchainAccountId: `eip155:${chainId}:${checksumAddress(d.address)}`,
      });
    }
    if (type === DELEGATE_TYPE_SIG_AUTH && !authentication.includes(id)) {
      authentication.push(id);
    }
    if (type === DELEGATE_TYPE_VERI_KEY && !assertionMethod.includes(id)) {
      assertionMethod.push(id);
    }
    if (type === DELEGATE_TYPE_SVC && !capabilityInvocation.includes(id)) {
      capabilityInvocation.push(id);
    }
  }

  let hasAssertionPurpose = false;
  for (const p of purposeVms ?? []) {
    const entry: DidDocument["verificationMethod"][number] = {
      id: p.id,
      type: p.type,
      controller: did,
    };
    if (p.blockchainAccountId) entry.blockchainAccountId = p.blockchainAccountId;
    if (p.publicKeyJwk) entry.publicKeyJwk = p.publicKeyJwk;
    if (p.publicKeyMultibase) entry.publicKeyMultibase = p.publicKeyMultibase;
    if (!verificationMethod.some((vm) => vm.id === p.id)) {
      verificationMethod.push(entry);
    }
    if (p.relationship === "authentication" && !authentication.includes(p.id)) {
      authentication.push(p.id);
    }
    if (p.relationship === "assertionMethod") {
      hasAssertionPurpose = true;
      if (!assertionMethod.includes(p.id)) assertionMethod.push(p.id);
    }
    if (p.relationship === "keyAgreement" && !keyAgreement.includes(p.id)) {
      keyAgreement.push(p.id);
    }
  }
  if (hasAssertionPurpose) {
    assertionMethod = assertionMethod.filter((id) => id !== vmId);
    if (!assertionMethod.length) {
      const assertVm = purposeVms?.find((p) => p.relationship === "assertionMethod");
      if (assertVm) assertionMethod = [assertVm.id];
    }
  }

  const doc: DidDocument = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    controller: did,
    verificationMethod,
    authentication,
    assertionMethod,
  };
  if (keyAgreement.length) {
    doc.keyAgreement = keyAgreement;
  }
  if (capabilityInvocation.length) {
    doc.capabilityInvocation = capabilityInvocation;
  }
  if (services && services.length > 0) {
    doc.service = services;
  }
  if (deactivated) {
    doc.deactivated = true;
  }
  return doc;
}

/** @deprecated Prefer `resolveDidDocument` (v0.2). */
export function resolveDidMinimal(
  did: string,
  deactivated = false,
  services?: DidService[]
): DidDocument {
  return resolveDidDocument(did, deactivated, services);
}

export function schemaIdFromKey(key: string): Hex {
  return keccak256(toBytes(key));
}

export function assertAddress(value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`Invalid address: ${value}`);
  }
  return getAddress(value);
}
