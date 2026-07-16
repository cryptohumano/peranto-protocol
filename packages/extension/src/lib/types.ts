import type { Address, Hex } from "viem";
import type { ContractAddresses, PerantoNetwork } from "@peranto/sdk";

/** Identidad Aura: mnemonic → EVM (PVM/eth-rpc) + Substrate. */
export type AuraIdentity = {
  mnemonic?: string;
  privateKey: Hex;
  address: Address;
  did: string;
  substrate?: {
    sr25519Address: string;
    ed25519Address: string;
    sr25519PublicKey: Hex;
    ed25519PublicKey: Hex;
  };
  evmMappedAccountId32?: Hex;
};

export type StoredCredential = {
  id: string;
  jwt: string;
  credHash: Hex;
  schemaKey: string;
  issuerDid: string;
  subjectDid: string;
  label: string;
  savedAt: string;
  anchorTx?: Hex;
};

export type AuraSettings = {
  network: PerantoNetwork;
  rpcUrl: string;
  /** WS Substrate nativo (extrinsics / indexing); opcional. */
  substrateWsUrl?: string;
  addresses: ContractAddresses;
};

export type AuraState = {
  identity: AuraIdentity | null;
  credentials: StoredCredential[];
  settings: AuraSettings;
  knownNodes: Array<{ address: Address; name: string }>;
};

/** Default Hardhat local deploy (re-deploy may change these). */
export const DEFAULT_HARDHAT_ADDRESSES: ContractAddresses = {
  ProtocolTreasury: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  DisCOFactory: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  PerantoNode: "0xCafac3dD18aC6c6e92c921884f9E4176737C052c",
  DIDRegistry: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  SchemaRegistry: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  AttesterRegistry: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
  CredentialStatusRegistry: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
  NameRegistry: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
};

/** Bundled Paseo Hub TestNet deploy (keep in sync with deployments/420420417.json). */
export const DEFAULT_PASEO_ADDRESSES: ContractAddresses = {
  ProtocolTreasury: "0x9c675988Da8E1767618325f9828461920DA796c4",
  DisCOFactory: "0x90a6Fad1ee4bc633316DB1afF39537268D5A52f1",
  PerantoNode: "0x028A287dB4E63198dFa46F7c63a50aceFE4bE50e",
  EcosystemLabNode: "0xF2C0395933EbD381d8F6dCdb6211deb729f28dCD",
  DIDRegistry: "0xC4152D37015255C54BbBaEF9c2797dE634946B18",
  SchemaRegistry: "0x273644C4231F31EB0237B8d55eF81Be47063D012",
  AttesterRegistry: "0x17E4ACfc4c850f9947babccE6Df5Da828BC5b6aC",
  CredentialStatusRegistry: "0x1E24ab96972Aa962FADCaab48803a1d759e4067a",
  NameRegistry: "0x6834acE72E89b26eA21EcB514BA3b24a8C1D7EC3",
};

export function defaultSettings(network: PerantoNetwork = "paseo"): AuraSettings {
  const rpc: Record<PerantoNetwork, string> = {
    hardhat: "http://127.0.0.1:8545",
    localhost: "http://127.0.0.1:8545",
    paseo: "https://eth-rpc-testnet.polkadot.io/",
    base: "https://mainnet.base.org",
    baseSepolia: "https://sepolia.base.org",
    arbitrum: "https://arb1.arbitrum.io/rpc",
    arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc",
  };
  if (network === "hardhat" || network === "localhost") {
    return {
      network: "hardhat",
      rpcUrl: rpc.hardhat,
      substrateWsUrl: "",
      addresses: DEFAULT_HARDHAT_ADDRESSES,
    };
  }
  if (network === "paseo") {
    return {
      network: "paseo",
      rpcUrl: rpc.paseo,
      substrateWsUrl: "wss://rpc.paseo.dev",
      addresses: DEFAULT_PASEO_ADDRESSES,
    };
  }
  return {
    network,
    rpcUrl: rpc[network],
    substrateWsUrl: "",
    addresses: {
      DIDRegistry: "0x0000000000000000000000000000000000000000",
      SchemaRegistry: "0x0000000000000000000000000000000000000000",
      AttesterRegistry: "0x0000000000000000000000000000000000000000",
      CredentialStatusRegistry: "0x0000000000000000000000000000000000000000",
    },
  };
}

export const STATUS_LABELS = ["None", "Active", "Revoked"] as const;

export type ExtensionMessage =
  | { type: "GET_STATE" }
  | { type: "CREATE_IDENTITY" }
  | { type: "IMPORT_IDENTITY"; privateKey: string }
  | { type: "IMPORT_MNEMONIC"; mnemonic: string }
  | { type: "CLEAR_IDENTITY" }
  | { type: "UPDATE_SETTINGS"; settings: Partial<AuraSettings> }
  | { type: "IMPORT_DEPLOYMENT"; json: string }
  | {
      type: "ACTION";
      action: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: "PROVIDER_REQUEST";
      id: number;
      method: string;
      params?: unknown[];
    };

export type ExtensionResponse =
  | { ok: true; state?: AuraState; data?: unknown }
  | { ok: false; error: string };
