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
  ProtocolTreasury: "0x28d5eABFd6059EEacb3403ab87b19231C98a10cd",
  DisCOFactory: "0xf9Ce67d606cf4416e9FDFdA6EA7579888402B72C",
  PerantoNode: "0x6DF1F4B42C033762C91FB467a5C059A940b13788",
  EcosystemLabNode: "0x5085113140A5b99ED837eDdc4E8fdF48C131B034",
  DIDRegistry: "0x487183414D0eF7C20c57b18c391567D5D3473124",
  SchemaRegistry: "0xC73c1F9773291Aa03Aac89B74BD388BcCD1E682E",
  AttesterRegistry: "0xeA4fCB68bCa0FF44c96799054bb7b551067B5D7e",
  CredentialStatusRegistry: "0xC44ECE9509B4f7804520AF5bef4450CCd80e62EA",
  NameRegistry: "0x42eb2Fe585c7A4cD803a2F1A3ccF3869F3bf68da",
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
