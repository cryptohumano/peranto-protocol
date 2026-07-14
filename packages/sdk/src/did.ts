import {
  type Address,
  type Hex,
  checksumAddress,
  getAddress,
  isAddress,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

export type PerantoNetwork = "hardhat" | "localhost" | "paseo";

export const NETWORK_CHAIN_ID: Record<PerantoNetwork, number> = {
  hardhat: 31337,
  localhost: 31337,
  paseo: 420420417,
};

export const CHAIN_ID_NETWORK: Record<number, PerantoNetwork> = {
  31337: "hardhat",
  420420417: "paseo",
};

const DID_RE =
  /^did:peranto:(hardhat|localhost|paseo):(0x[a-fA-F0-9]{40})$/;

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
  deactivated?: boolean;
};

/** Minimal / implicit resolve (no chain reads). Enriched resolve is via PerantoClient.resolveDid. */
export function resolveDidMinimal(did: string, deactivated = false): DidDocument {
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
