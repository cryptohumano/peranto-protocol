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
    blockchainAccountId: string;
  }>;
  authentication: string[];
  assertionMethod: string[];
  service?: DidService[];
  deactivated?: boolean;
};

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
export function resolveDidMinimal(
  did: string,
  deactivated = false,
  services?: DidService[]
): DidDocument {
  const { network, address } = parseDid(did);
  const chainId = NETWORK_CHAIN_ID[network];
  const vmId = `${did}#controller`;
  const doc: DidDocument = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    controller: did,
    verificationMethod: [
      {
        id: vmId,
        type: "EcdsaSecp256k1RecoveryMethod2020",
        controller: did,
        blockchainAccountId: `eip155:${chainId}:${checksumAddress(address)}`,
      },
    ],
    authentication: [vmId],
    assertionMethod: [vmId],
  };
  if (services && services.length > 0) {
    doc.service = services;
  }
  if (deactivated) {
    doc.deactivated = true;
  }
  return doc;
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
