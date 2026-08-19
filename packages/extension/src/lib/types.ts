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
  /** Compliance openings — never share to curator; used for local ZK prove. */
  meta?: {
    claimsCommitment?: Hex;
    commitmentSalt?: Hex;
    validUntil?: number;
  };
};

export type AuraSettings = {
  network: PerantoNetwork;
  rpcUrl: string;
  /** WS Substrate nativo (extrinsics / indexing); opcional. */
  substrateWsUrl?: string;
  addresses: ContractAddresses;
  /** holder = UX Sporran-like; lab = attester / DisCO / firmas avanzadas */
  uiMode?: "holder" | "lab";
};

export type AuraState = {
  identity: AuraIdentity | null;
  credentials: StoredCredential[];
  settings: AuraSettings;
  knownNodes: Array<{ address: Address; name: string }>;
  /** Cached domain-linkage trusts (also mirrored in chrome.storage aura_dl_*). */
  trustedSites?: Array<{
    origin: string;
    issuerDid: string;
    verifiedAt: string;
    expiresAt: string;
  }>;
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
  ProtocolTreasury: "0x45e8ade918FB36867325E298a5A76180dd1DFF99",
  DisCOFactory: "0x988550A4bAD29F3d11BcAf5cB7274Ae1d0282b99",
  PerantoNode: "0xCc340938b25AA8D2C08760735611Ae57e75F8786",
  EcosystemLabNode: "0x99125a8024220e6A757282C9B07524B411872E2E",
  DIDRegistry: "0xe7e10dD5fd25053A3c35EDa8A771753B3E57D907",
  SchemaRegistry: "0xe76472ff2212B5aC8E027120043D30D520BD86B1",
  AttesterRegistry: "0x963eA758320e5273885EEF53bE99c608d5C555AB",
  CredentialStatusRegistry: "0xb321Ae1E98476752867a6191F74AeD2353c0c534",
  NameRegistry: "0x76b82117623Cc3793e0FA3768aE16A123Eaf9134",
  ComplianceZkVerifier: "0x4BA2dfc1Cbb370C3712fe011d9333bfb0CE0419E",
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
      uiMode: "holder",
    };
  }
  if (network === "paseo") {
    return {
      network: "paseo",
      rpcUrl: rpc.paseo,
      substrateWsUrl: "wss://rpc.paseo.dev",
      addresses: DEFAULT_PASEO_ADDRESSES,
      uiMode: "holder",
    };
  }
  return {
    network,
    rpcUrl: rpc[network],
    substrateWsUrl: "",
    uiMode: "holder",
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
      /** Page origin from content script (`location.origin`). */
      origin?: string;
      pathname?: string;
      pageHref?: string;
      /** Optional pre-fetched `/.well-known/did-configuration.json`. */
      didConfiguration?: unknown;
    }
  | { type: "FORGET_TRUSTED_SITE"; origin: string }
  | { type: "FORGET_ALL_TRUSTED_SITES" }
  | { type: "GET_PENDING_AUTH" }
  | { type: "APPROVE_PENDING_SITE" }
  | { type: "REJECT_PENDING_SITE" }
  | { type: "GET_PENDING_HOLDER" }
  | { type: "APPROVE_SAVE_CREDENTIAL" }
  | { type: "APPROVE_SHARE_CREDENTIAL"; credHash: string; disclose?: string[] }
  | { type: "APPROVE_PROVE_COMPLIANCE" }
  | { type: "REJECT_HOLDER_REQUEST"; reason?: string };

export type ExtensionResponse =
  | { ok: true; state?: AuraState; data?: unknown }
  | { ok: false; error: string };
