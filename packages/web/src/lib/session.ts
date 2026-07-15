import type { Address, Hex } from "viem";
import {
  createMultiKeyIdentity,
  importMultiKeyFromMnemonic,
  importEvmOnlyIdentity,
  formatDid,
  type PerantoNetwork,
} from "@peranto/sdk";

const SESSION_KEY = "peranto.session.v1";
const NAMES_KEY = "peranto.known-names.v1";

export type SessionIdentity = {
  address: Address;
  did: string;
  /** Human-readable NameRegistry primary label, if any. */
  displayName?: string | null;
  privateKey?: Hex;
  mnemonic?: string;
  source: "hd" | "import" | "aura";
};

export function loadSession(): SessionIdentity | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionIdentity;
  } catch {
    return null;
  }
}

export function saveSession(s: SessionIdentity | null) {
  if (!s) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent("peranto:session", { detail: s }));
}

/** Labels this browser has seen for an address (helps resolve primary without full logs). */
export function rememberName(address: Address, label: string) {
  const key = address.toLowerCase();
  const all = loadKnownNames();
  const set = new Set(all[key] ?? []);
  set.add(label.toLowerCase());
  all[key] = [...set];
  localStorage.setItem(NAMES_KEY, JSON.stringify(all));
}

export function knownNamesFor(address: Address): string[] {
  return loadKnownNames()[address.toLowerCase()] ?? [];
}

function loadKnownNames(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<
      string,
      string[]
    >;
  } catch {
    return {};
  }
}

export async function createHdSession(network: PerantoNetwork = "paseo"): Promise<SessionIdentity> {
  const multi = await createMultiKeyIdentity(network);
  const s: SessionIdentity = {
    address: multi.evm.address,
    did: multi.evm.did,
    privateKey: multi.evm.privateKey,
    mnemonic: multi.mnemonic,
    source: "hd",
  };
  saveSession(s);
  return s;
}

export async function importMnemonicSession(
  mnemonic: string,
  network: PerantoNetwork = "paseo"
): Promise<SessionIdentity> {
  const multi = await importMultiKeyFromMnemonic(mnemonic, network);
  const s: SessionIdentity = {
    address: multi.evm.address,
    did: multi.evm.did,
    privateKey: multi.evm.privateKey,
    mnemonic: multi.mnemonic,
    source: "hd",
  };
  saveSession(s);
  return s;
}

export function importKeySession(privateKey: Hex, network: PerantoNetwork = "paseo"): SessionIdentity {
  const only = importEvmOnlyIdentity(privateKey, network);
  const s: SessionIdentity = {
    address: only.evm.address,
    did: only.evm.did,
    privateKey: only.evm.privateKey,
    source: "import",
  };
  saveSession(s);
  return s;
}

export function sessionFromAura(address: Address, network: PerantoNetwork = "paseo"): SessionIdentity {
  const s: SessionIdentity = {
    address,
    did: formatDid(network, address),
    source: "aura",
  };
  saveSession(s);
  return s;
}
