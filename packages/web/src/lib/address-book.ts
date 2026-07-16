import type { Address } from "viem";
import { getAddress, isAddress } from "viem";

const KEY = "peranto.addressBook.v1";

/** Public link snapshot saved from linktr33. */
export type AddressBookLink = {
  label: string;
  href: string;
  type: string;
  attrKey?: string;
};

export type AddressBookEntry = {
  id: string;
  address: Address;
  label: string;
  note?: string;
  createdAt: string;
  /** Set when saved from a public linktr33 page */
  source?: "linktr33" | "manual";
  shareUrl?: string;
  links?: AddressBookLink[];
};

function normalize(address: string): Address {
  if (!isAddress(address)) throw new Error("Address inválida");
  return getAddress(address);
}

export function loadAddressBook(): AddressBookEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as AddressBookEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list: AddressBookEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("peranto:addressBook", { detail: list }));
}

export function upsertAddressBookEntry(input: {
  address: string;
  label: string;
  note?: string;
  id?: string;
  source?: AddressBookEntry["source"];
  shareUrl?: string;
  links?: AddressBookLink[];
}): AddressBookEntry {
  const address = normalize(input.address);
  const label = input.label.trim() || shortLabel(address);
  const links = input.links?.length
    ? input.links.map((l) => ({
        label: l.label.trim().slice(0, 48),
        href: l.href.trim(),
        type: l.type.trim(),
        attrKey: l.attrKey?.trim(),
      }))
    : undefined;
  const list = loadAddressBook();
  const existing =
    (input.id && list.find((e) => e.id === input.id)) ||
    list.find((e) => e.address.toLowerCase() === address.toLowerCase());

  if (existing) {
    const next: AddressBookEntry = {
      ...existing,
      address,
      label,
      note: input.note?.trim() || undefined,
      source: input.source ?? existing.source,
      shareUrl: input.shareUrl?.trim() || existing.shareUrl,
      links: links?.length ? links : existing.links,
    };
    persist(list.map((e) => (e.id === existing.id ? next : e)));
    return next;
  }

  const entry: AddressBookEntry = {
    id: `ab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    address,
    label,
    note: input.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
    source: input.source,
    shareUrl: input.shareUrl?.trim() || undefined,
    links: links?.length ? links : undefined,
  };
  persist([entry, ...list]);
  return entry;
}

export function removeAddressBookEntry(id: string) {
  persist(loadAddressBook().filter((e) => e.id !== id));
}

export function findAddressBookLabel(address: string): string | undefined {
  if (!isAddress(address)) return undefined;
  const want = address.toLowerCase();
  return loadAddressBook().find((e) => e.address.toLowerCase() === want)?.label;
}

function shortLabel(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Seed libreta from known smoke roles if empty (addresses only — no keys). */
export function seedAddressBookFromSmokeRoles(
  roles: Array<{ id: string; address: string; blurb?: string }>
) {
  if (loadAddressBook().length > 0) return;
  for (const r of roles) {
    try {
      upsertAddressBookEntry({
        address: r.address,
        label: r.id,
        note: r.blurb,
      });
    } catch {
      /* skip bad */
    }
  }
}
