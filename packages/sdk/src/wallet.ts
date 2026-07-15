import { cryptoWaitReady, mnemonicGenerate, mnemonicValidate } from "@polkadot/util-crypto";
import { Keyring } from "@polkadot/keyring";
import { hexToU8a, u8aToHex } from "@polkadot/util";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { type Address, type Hex, recoverMessageAddress } from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  signMessage,
} from "viem/accounts";
import { formatDid, type PerantoNetwork } from "./did";

export type SignatureScheme = "secp256k1" | "sr25519" | "ed25519";

export type MultiKeyIdentity = {
  /** BIP39 — root común EVM + Substrate. */
  mnemonic: string;
  /** secp256k1 — EVM, PVM eth-rpc, JWT ES256K / did:peranto */
  evm: {
    privateKey: Hex;
    address: Address;
    did: string;
  };
  /** Substrate nativo (SS58, format 42 = generic substrate). */
  substrate: {
    sr25519Address: string;
    ed25519Address: string;
    sr25519PublicKey: Hex;
    ed25519PublicKey: Hex;
  };
  /**
   * AccountId32 desde H160 (suffix 0xee × 12) —
   * mapeo eth→substrate en Hub / pallet-revive.
   */
  evmMappedAccountId32: Hex;
};

const ETH_PATH = "m/44'/60'/0'/0/0";

let ready: Promise<boolean> | null = null;

export function ensureCryptoReady(): Promise<boolean> {
  if (!ready) ready = cryptoWaitReady();
  return ready;
}

/** H160 → AccountId32 con padding `0xee` (eth-mapped accounts). */
export function ethAddressToAccountId32(address: Address): Hex {
  const body = address.toLowerCase().replace(/^0x/, "");
  if (body.length !== 40) {
    throw new Error(`Invalid eth address: ${address}`);
  }
  return `0x${body}${"ee".repeat(12)}` as Hex;
}

function evmPrivateKeyFromMnemonic(mnemonic: string): Hex {
  const seed = mnemonicToSeedSync(mnemonic);
  const child = HDKey.fromMasterSeed(seed).derive(ETH_PATH);
  if (!child.privateKey) {
    throw new Error("No se pudo derivar clave EVM del mnemonic");
  }
  return u8aToHex(child.privateKey) as Hex;
}

function deriveFromMnemonic(
  mnemonic: string,
  network: PerantoNetwork
): MultiKeyIdentity {
  const trimmed = mnemonic.trim().replace(/\s+/g, " ");
  if (!mnemonicValidate(trimmed)) {
    throw new Error("Mnemonic BIP39 inválido");
  }

  const privateKey = evmPrivateKeyFromMnemonic(trimmed);
  const account = privateKeyToAccount(privateKey);

  const sr = new Keyring({ type: "sr25519", ss58Format: 42 }).addFromUri(trimmed);
  const ed = new Keyring({ type: "ed25519", ss58Format: 42 }).addFromUri(trimmed);

  return {
    mnemonic: trimmed,
    evm: {
      privateKey,
      address: account.address,
      did: formatDid(network, account.address),
    },
    substrate: {
      sr25519Address: sr.address,
      ed25519Address: ed.address,
      sr25519PublicKey: u8aToHex(sr.publicKey) as Hex,
      ed25519PublicKey: u8aToHex(ed.publicKey) as Hex,
    },
    evmMappedAccountId32: ethAddressToAccountId32(account.address),
  };
}

export async function createMultiKeyIdentity(
  network: PerantoNetwork = "hardhat",
  words: 12 | 24 = 12
): Promise<MultiKeyIdentity> {
  await ensureCryptoReady();
  return deriveFromMnemonic(mnemonicGenerate(words), network);
}

export async function importMultiKeyFromMnemonic(
  mnemonic: string,
  network: PerantoNetwork = "hardhat"
): Promise<MultiKeyIdentity> {
  await ensureCryptoReady();
  return deriveFromMnemonic(mnemonic, network);
}

/** Solo EVM (importación de clave suelta). Sin Substrate hasta vincular mnemonic. */
export function importEvmOnlyIdentity(
  privateKey: Hex,
  network: PerantoNetwork = "hardhat"
): {
  evm: MultiKeyIdentity["evm"];
  evmMappedAccountId32: Hex;
} {
  const key = (privateKey.startsWith("0x")
    ? privateKey
    : `0x${privateKey}`) as Hex;
  const account = privateKeyToAccount(key);
  return {
    evm: {
      privateKey: key,
      address: account.address,
      did: formatDid(network, account.address),
    },
    evmMappedAccountId32: ethAddressToAccountId32(account.address),
  };
}

export function createEvmOnlyIdentity(network: PerantoNetwork = "hardhat") {
  return importEvmOnlyIdentity(generatePrivateKey(), network);
}

function toBytes(message: string, encoding: "utf8" | "hex"): Uint8Array {
  if (encoding === "hex") {
    const h = message.startsWith("0x") ? message : `0x${message}`;
    return hexToU8a(h);
  }
  return new TextEncoder().encode(message);
}

export type SignResult = {
  scheme: SignatureScheme;
  messageEncoding: "utf8" | "hex";
  message: string;
  signature: Hex;
  address: string;
  publicKey?: Hex;
  recoveredAddress?: Address;
};

/**
 * Firma multi-cadena:
 * - secp256k1 → EIP-191 personal_sign (EVM + PVM vía eth-rpc)
 * - sr25519 / ed25519 → firma raw Substrate
 */
export async function signPayload(params: {
  scheme: SignatureScheme;
  message: string;
  encoding?: "utf8" | "hex";
  evmPrivateKey?: Hex;
  mnemonic?: string;
}): Promise<SignResult> {
  const encoding = params.encoding ?? "utf8";
  const bytes = toBytes(params.message, encoding);

  if (params.scheme === "secp256k1") {
    if (!params.evmPrivateKey) throw new Error("evmPrivateKey requerido");
    const account = privateKeyToAccount(params.evmPrivateKey);
    const message =
      encoding === "utf8"
        ? params.message
        : ({ raw: bytes } as const);
    const signature = await signMessage({
      privateKey: params.evmPrivateKey,
      message: message as never,
    });
    const recovered = await recoverMessageAddress({
      message: message as never,
      signature,
    });
    return {
      scheme: "secp256k1",
      messageEncoding: encoding,
      message: params.message,
      signature,
      address: account.address,
      recoveredAddress: recovered,
    };
  }

  await ensureCryptoReady();
  if (!params.mnemonic) throw new Error("mnemonic requerido para Substrate");
  const pair = new Keyring({
    type: params.scheme,
    ss58Format: 42,
  }).addFromUri(params.mnemonic.trim());
  const signature = u8aToHex(pair.sign(bytes)) as Hex;
  return {
    scheme: params.scheme,
    messageEncoding: encoding,
    message: params.message,
    signature,
    address: pair.address,
    publicKey: u8aToHex(pair.publicKey) as Hex,
  };
}

/** Firma payload hex de un extrinsic Substrate (txwrapper / dApp construye bytes). */
export async function signSubstrateExtrinsicPayload(params: {
  scheme: "sr25519" | "ed25519";
  payloadHex: Hex;
  mnemonic: string;
}): Promise<SignResult> {
  return signPayload({
    scheme: params.scheme,
    message: params.payloadHex,
    encoding: "hex",
    mnemonic: params.mnemonic,
  });
}

export async function verifyPayload(params: {
  scheme: SignatureScheme;
  message: string;
  encoding?: "utf8" | "hex";
  signature: Hex;
  addressOrPublicKey: string;
}): Promise<{ valid: boolean }> {
  const encoding = params.encoding ?? "utf8";
  const bytes = toBytes(params.message, encoding);

  if (params.scheme === "secp256k1") {
    try {
      const message =
        encoding === "utf8"
          ? params.message
          : ({ raw: bytes } as const);
      const recovered = await recoverMessageAddress({
        message: message as never,
        signature: params.signature,
      });
      return {
        valid:
          recovered.toLowerCase() === params.addressOrPublicKey.toLowerCase(),
      };
    } catch {
      return { valid: false };
    }
  }

  await ensureCryptoReady();
  const kr = new Keyring({ type: params.scheme, ss58Format: 42 });
  const publicKey = params.addressOrPublicKey.startsWith("0x")
    ? hexToU8a(params.addressOrPublicKey)
    : kr.decodeAddress(params.addressOrPublicKey);
  const ss58 = params.addressOrPublicKey.startsWith("0x")
    ? kr.encodeAddress(publicKey)
    : params.addressOrPublicKey;
  const pair = kr.addFromAddress(ss58);
  return {
    valid: pair.verify(bytes, hexToU8a(params.signature), publicKey),
  };
}
