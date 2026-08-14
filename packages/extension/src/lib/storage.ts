import type { AuraIdentity, AuraSettings, AuraState, StoredCredential } from "./types";
import { defaultSettings } from "./types";
import type { Address } from "viem";

const KEY = "aura_v1";

type Persisted = {
  identity: AuraIdentity | null;
  credentials: StoredCredential[];
  settings: AuraSettings;
  knownNodes: Array<{ address: Address; name: string }>;
  trustedSites?: AuraState["trustedSites"];
};

async function read(): Promise<Persisted> {
  const raw = await chrome.storage.local.get(KEY);
  const data = raw[KEY] as Persisted | undefined;
  if (!data) {
    return {
      identity: null,
      credentials: [],
      settings: defaultSettings("paseo"),
      knownNodes: [],
      trustedSites: [],
    };
  }
  return {
    identity: data.identity ?? null,
    credentials: data.credentials ?? [],
    settings: data.settings ?? defaultSettings("paseo"),
    knownNodes: data.knownNodes ?? [],
    trustedSites: data.trustedSites ?? [],
  };
}

async function write(patch: Partial<Persisted>): Promise<Persisted> {
  const current = await read();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function getState(): Promise<AuraState> {
  return read();
}

export async function setIdentity(identity: AuraIdentity | null) {
  return write({ identity });
}

export async function setSettings(settings: AuraSettings) {
  return write({ settings });
}

export async function patchSettings(partial: Partial<AuraSettings>) {
  const current = await read();
  return write({ settings: { ...current.settings, ...partial } });
}

export async function addCredential(cred: StoredCredential) {
  const current = await read();
  const credentials = [
    cred,
    ...current.credentials.filter((c) => c.credHash !== cred.credHash),
  ];
  return write({ credentials });
}

export async function removeCredential(credHash: string) {
  const current = await read();
  return write({
    credentials: current.credentials.filter((c) => c.credHash !== credHash),
  });
}

export async function rememberNode(address: Address, name: string) {
  const current = await read();
  const knownNodes = [
    { address, name },
    ...current.knownNodes.filter(
      (n) => n.address.toLowerCase() !== address.toLowerCase()
    ),
  ];
  return write({ knownNodes });
}

export async function setTrustedSites(
  trustedSites: NonNullable<AuraState["trustedSites"]>
) {
  return write({ trustedSites });
}

export async function clearAll() {
  await chrome.storage.local.remove(KEY);
}
