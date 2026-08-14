/**
 * Domain linkage gate for Aura (docs/well-known-did-configuration.md).
 * Crypto verify + user approval (Sporran-style) before sensitive dapp APIs.
 */
import {
  isLocalhostOrigin,
  normalizeOrigin,
  verifyDomainLinkage,
  type DidConfigurationDocument,
} from "@peranto/sdk";
import { buildClient } from "./actions";
import * as storage from "./storage";
import { openAuraConsentWindow } from "./open-consent";

const CACHE_TTL_MS = 60 * 60 * 1000;
const PENDING_KEY = "aura_pending_auth";
const APPROVED_PREFIX = "aura_approved_";

/** peranto_action methods that do not require domain linkage. */
const SAFE_PERANTO_ACTIONS = new Set([
  "did.resolve",
  "name.resolve",
  "vc.verify",
  "rpc.ping",
  "wallet.addresses",
  "sign.verify",
  "attester.isAuthorized",
]);

export const NEEDS_APPROVAL_PREFIX = "AURA_NEEDS_APPROVAL:";

export function isSensitiveProviderMethod(
  method: string,
  params: unknown[] = []
): boolean {
  if (method === "wallet_getCredentials") return true;
  if (method === "peranto_requestSession") return true;
  if (method === "peranto_saveCredential") return true;
  if (method === "wallet_saveCredential") return true;
  if (method === "peranto_requestCredential") return true;
  if (method === "wallet_requestCredential") return true;
  if (method === "peranto_proveComplianceGate") return true;
  if (method === "peranto_action") {
    const action = String(params[0] ?? "");
    if (!action) return true;
    return !SAFE_PERANTO_ACTIONS.has(action);
  }
  return false;
}

export type TrustedSite = {
  origin: string;
  issuerDid: string;
  verifiedAt: string;
  expiresAt: string;
};

export type PendingAuthorization = {
  origin: string;
  issuerDid: string;
  createdAt: string;
};

function cacheKey(origin: string): string {
  return `aura_dl_${origin}`;
}

function approvedKey(origin: string): string {
  return `${APPROVED_PREFIX}${origin}`;
}

export async function getTrustedSites(): Promise<TrustedSite[]> {
  const raw = await chrome.storage.local.get(null);
  const sites: TrustedSite[] = [];
  const now = Date.now();
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith("aura_dl_")) continue;
    const site = v as TrustedSite;
    if (!site?.origin || !site.expiresAt) continue;
    if (Date.parse(site.expiresAt) < now) {
      await chrome.storage.local.remove(k);
      continue;
    }
    sites.push(site);
  }
  sites.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
  return sites;
}

export async function forgetTrustedSite(origin: string): Promise<void> {
  const n = normalizeOrigin(origin);
  if (!n) return;
  await chrome.storage.local.remove([cacheKey(n), approvedKey(n)]);
}

export async function forgetAllTrustedSites(): Promise<void> {
  const raw = await chrome.storage.local.get(null);
  const keys = Object.keys(raw).filter(
    (k) => k.startsWith("aura_dl_") || k.startsWith(APPROVED_PREFIX)
  );
  if (keys.length) await chrome.storage.local.remove(keys);
}

async function readCache(origin: string): Promise<TrustedSite | null> {
  const raw = await chrome.storage.local.get(cacheKey(origin));
  const site = raw[cacheKey(origin)] as TrustedSite | undefined;
  if (!site?.expiresAt) return null;
  if (Date.parse(site.expiresAt) < Date.now()) {
    await chrome.storage.local.remove(cacheKey(origin));
    return null;
  }
  return site;
}

async function writeCache(site: TrustedSite): Promise<void> {
  await chrome.storage.local.set({ [cacheKey(site.origin)]: site });
}

async function isUserApproved(origin: string): Promise<boolean> {
  const raw = await chrome.storage.local.get(approvedKey(origin));
  return Boolean(raw[approvedKey(origin)]);
}

async function setUserApproved(origin: string, issuerDid: string): Promise<void> {
  await chrome.storage.local.set({
    [approvedKey(origin)]: {
      origin,
      issuerDid,
      approvedAt: new Date().toISOString(),
    },
  });
}

export async function getPendingAuthorization(): Promise<PendingAuthorization | null> {
  const raw = await chrome.storage.local.get(PENDING_KEY);
  return (raw[PENDING_KEY] as PendingAuthorization | undefined) ?? null;
}

async function setPending(pending: PendingAuthorization | null): Promise<void> {
  if (!pending) {
    await chrome.storage.local.remove(PENDING_KEY);
    try {
      await chrome.action.setBadgeText({ text: "" });
    } catch {
      /* popup-only contexts */
    }
    return;
  }
  await chrome.storage.local.set({ [PENDING_KEY]: pending });
  try {
    await chrome.action.setBadgeText({ text: "1" });
    await chrome.action.setBadgeBackgroundColor({ color: "#1a5b92" });
  } catch {
    /* ignore */
  }
  void openAuraConsentWindow();
}

export async function approvePendingSite(): Promise<PendingAuthorization | null> {
  const pending = await getPendingAuthorization();
  if (!pending) return null;
  await setUserApproved(pending.origin, pending.issuerDid);
  await setPending(null);
  return pending;
}

export async function rejectPendingSite(): Promise<void> {
  const pending = await getPendingAuthorization();
  if (pending) {
    await chrome.storage.local.remove([
      cacheKey(pending.origin),
      approvedKey(pending.origin),
    ]);
  }
  await setPending(null);
}

/**
 * Verify page origin has a valid DomainLinkageCredential + user approval.
 */
export async function requireDomainLinkage(opts: {
  pageOrigin: string;
  didConfiguration?: DidConfigurationDocument | string | null;
  expectedDid?: string;
}): Promise<TrustedSite> {
  const pageOrigin = normalizeOrigin(opts.pageOrigin);
  if (!pageOrigin) {
    throw new Error("Aura: origen de página inválido (domain linkage)");
  }

  let site = await readCache(pageOrigin);

  if (
    !site ||
    (opts.expectedDid &&
      site.issuerDid.toLowerCase() !== opts.expectedDid.toLowerCase())
  ) {
    const client = await buildClient(false);
    const allowHttp = isLocalhostOrigin(pageOrigin);

    const result = await verifyDomainLinkage(pageOrigin, {
      didConfiguration: opts.didConfiguration ?? undefined,
      allowHttp,
      expectedDid: opts.expectedDid,
      resolveDid: (did) => client.resolveDid(did),
      fetchDidConfiguration: opts.didConfiguration
        ? undefined
        : async (url) => {
            const res = await fetch(url, {
              headers: { Accept: "application/json" },
            });
            if (!res.ok) {
              throw new Error(
                `Aura: no se pudo cargar well-known (${res.status}). La dapp debe publicar ${pageOrigin}/.well-known/did-configuration.json`
              );
            }
            return (await res.json()) as DidConfigurationDocument;
          },
    });

    if (!result.ok || !result.issuerDid) {
      throw new Error(
        `Aura: domain linkage falló — ${result.error ?? "origen no verificado"}. Publica /.well-known/did-configuration.json`
      );
    }

    const now = new Date();
    site = {
      origin: pageOrigin,
      issuerDid: result.issuerDid,
      verifiedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    };
    await writeCache(site);

    const state = await storage.getState();
    const trustedSites = [
      site,
      ...(state.trustedSites ?? []).filter(
        (s) => s.origin.toLowerCase() !== pageOrigin.toLowerCase()
      ),
    ].slice(0, 20);
    await storage.setTrustedSites(trustedSites);
  }

  if (await isUserApproved(pageOrigin)) {
    await setPending(null);
    return site;
  }

  await setPending({
    origin: pageOrigin,
    issuerDid: site.issuerDid,
    createdAt: new Date().toISOString(),
  });

  throw new Error(
    `${NEEDS_APPROVAL_PREFIX} Abre Aura y aprueba ${pageOrigin} (DID ${site.issuerDid})`
  );
}
