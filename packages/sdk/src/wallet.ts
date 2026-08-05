import { cryptoWaitReady, mnemonicGenerate, mnemonicValidate } from "@polkadot/util-crypto";
import { Keyring } from "@polkadot/keyring";
import { hexToU8a, u8aToHex } from "@polkadot/util";
import { edwardsToMontgomeryPub } from "@noble/curves/ed25519";
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

/** BIP44 ETH — controller / DID id / gas (method v0.2.1). */
export const ETH_PATH_CONTROLLER = "m/44'/60'/0'/0/0";
/** BIP44 ETH — authentication (login / SIWE). */
export const ETH_PATH_AUTHENTICATION = "m/44'/60'/0'/0/1";
/** BIP44 ETH — assertionMethod (JWT-VC ES256K). */
export const ETH_PATH_ASSERTION = "m/44'/60'/0'/0/2";
/** Substrate hard URI — Ed25519 seed → X25519 keyAgreement. */
export const KEY_AGREEMENT_URI_SUFFIX = "//did//keyAgreement//0";

const ETH_PATH = ETH_PATH_CONTROLLER;

export type PurposeSecpKey = {
  path: string;
  privateKey: Hex;
  address: Address;
  fragment: string;
};

export type PurposeKeyAgreement = {
  uriSuffix: string;
  /** Ed25519 public key (hex) before Montgomery conversion. */
  ed25519PublicKey: Hex;
  /** X25519 public key (32 bytes hex). */
  x25519PublicKey: Hex;
  /** JWK for DID Document (`X25519KeyAgreementKey2020`). */
  publicKeyJwk: {
    kty: "OKP";
    crv: "X25519";
    x: string;
  };
  fragment: string;
};

/** Derived purpose keys (v0.2.1). Controller = index 0 = DID address. */
export type PurposeKeys = {
  controller: PurposeSecpKey;
  authentication: PurposeSecpKey;
  assertion: PurposeSecpKey;
  keyAgreement: PurposeKeyAgreement;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

function evmPrivateKeyFromMnemonic(
  mnemonic: string,
  path: string = ETH_PATH
): Hex {
  const seed = mnemonicToSeedSync(mnemonic);
  const child = HDKey.fromMasterSeed(seed).derive(path);
  if (!child.privateKey) {
    throw new Error(`No se pudo derivar clave EVM del mnemonic (${path})`);
  }
  return u8aToHex(child.privateKey) as Hex;
}

function purposeSecpFromMnemonic(
  mnemonic: string,
  path: string,
  fragment: string
): PurposeSecpKey {
  const privateKey = evmPrivateKeyFromMnemonic(mnemonic, path);
  const account = privateKeyToAccount(privateKey);
  return { path, privateKey, address: account.address, fragment };
}

/**
 * Derive purpose keys from BIP39 mnemonic (hard paths, method v0.2.1).
 * - secp256k1: BIP44 `m/44'/60'/0'/0/{0,1,2}`
 * - keyAgreement: `{mnemonic}//did//keyAgreement//0` → Ed25519 → X25519
 */
export async function derivePurposeKeys(
  mnemonic: string,
  _network: PerantoNetwork = "hardhat"
): Promise<PurposeKeys> {
  await ensureCryptoReady();
  const trimmed = mnemonic.trim().replace(/\s+/g, " ");
  if (!mnemonicValidate(trimmed)) {
    throw new Error("Mnemonic BIP39 inválido");
  }

  const controller = purposeSecpFromMnemonic(
    trimmed,
    ETH_PATH_CONTROLLER,
    "controller"
  );
  const authentication = purposeSecpFromMnemonic(
    trimmed,
    ETH_PATH_AUTHENTICATION,
    "key-authentication"
  );
  const assertion = purposeSecpFromMnemonic(
    trimmed,
    ETH_PATH_ASSERTION,
    "key-assertion"
  );

  const ed = new Keyring({ type: "ed25519", ss58Format: 42 }).addFromUri(
    `${trimmed}${KEY_AGREEMENT_URI_SUFFIX}`
  );
  const x25519 = edwardsToMontgomeryPub(ed.publicKey);
  const x25519PublicKey = u8aToHex(x25519) as Hex;

  return {
    controller,
    authentication,
    assertion,
    keyAgreement: {
      uriSuffix: KEY_AGREEMENT_URI_SUFFIX,
      ed25519PublicKey: u8aToHex(ed.publicKey) as Hex,
      x25519PublicKey,
      publicKeyJwk: {
        kty: "OKP",
        crv: "X25519",
        x: bytesToBase64Url(x25519),
      },
      fragment: "key-agreement",
    },
  };
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
