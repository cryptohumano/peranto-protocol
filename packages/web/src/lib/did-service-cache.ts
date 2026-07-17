import type { DidDocument, DidService } from "@peranto/sdk";

type CachedSvc = {
  attrKey: string;
  type: string;
  serviceEndpoint: DidService["serviceEndpoint"];
  id?: string;
  name?: string;
};

type SyncState = {
  syncedToBlock: string;
  /** All DID services with attrKey (incl. PerantoPage), not only public links. */
  services: CachedSvc[];
};

const PAGE_TYPES = new Set(["PerantoPage"]);

function cacheKey(registry: string, did: string): string {
  // v3 — invalidate caches that restored deleted links (merge v4 ghosts)
  return `peranto:did-svc-v3:${registry.toLowerCase()}:${did.toLowerCase()}`;
}

function syncKey(registry: string, did: string): string {
  return `peranto:did-svc-sync-v2:${registry.toLowerCase()}:${did.toLowerCase()}`;
}

function recentKey(did: string): string {
  return `peranto:did-svc-recent:${did.toLowerCase()}`;
}

function readCache(registry: string, did: string): CachedSvc[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(cacheKey(registry, did));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedSvc[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readDidSyncState(
  registry: string,
  did: string
): SyncState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(syncKey(registry, did));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncState;
    if (!parsed?.syncedToBlock || !Array.isArray(parsed.services)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDidSyncState(
  registry: string,
  did: string,
  syncedToBlock: bigint,
  services: DidService[]
) {
  if (typeof localStorage === "undefined") return;
  const payload: SyncState = {
    syncedToBlock: syncedToBlock.toString(),
    services: services
      .filter((s) => s.attrKey)
      .map((s) => ({
        attrKey: s.attrKey!,
        type: s.type,
        serviceEndpoint: s.serviceEndpoint,
        id: s.id,
        name: typeof s.name === "string" ? s.name : undefined,
      })),
  };
  try {
    localStorage.setItem(syncKey(registry, did), JSON.stringify(payload));
  } catch {
    /* quota */
  }
  writeCache(registry, did, services);
}

/** Drop sync cursor + link cache so the next resolve does a cold lookback. */
export function clearDidSyncState(registry: string, did: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(syncKey(registry, did));
    localStorage.removeItem(cacheKey(registry, did));
  } catch {
    /* ignore */
  }
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(recentKey(did));
    } catch {
      /* ignore */
    }
  }
}

function readRecentAttrKeys(did: string): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(recentKey(did));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(
      Array.isArray(parsed) ? parsed.map((k) => k.toLowerCase()) : []
    );
  } catch {
    return new Set();
  }
}

function writeRecentAttrKeys(did: string, keys: Iterable<string>) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      recentKey(did),
      JSON.stringify([...new Set([...keys].map((k) => k.toLowerCase()))])
    );
  } catch {
    /* quota */
  }
}

function markRecentAttrKey(did: string, attrKey: string) {
  const set = readRecentAttrKeys(did);
  set.add(attrKey.toLowerCase());
  writeRecentAttrKeys(did, set);
}

function forgetRecentAttrKey(did: string, attrKey: string) {
  const set = readRecentAttrKeys(did);
  set.delete(attrKey.toLowerCase());
  writeRecentAttrKeys(did, set);
}

function isLinkService(s: DidService): boolean {
  if (!s.attrKey) return false;
  if (PAGE_TYPES.has(s.type) || s.attrKey.startsWith("PerantoPage")) return false;
  return true;
}

function writeCache(registry: string, did: string, services: DidService[]) {
  if (typeof localStorage === "undefined") return;
  const payload: CachedSvc[] = [];
  for (const s of services) {
    if (!s.attrKey || !isLinkService(s)) continue;
    payload.push({
      attrKey: s.attrKey,
      type: s.type,
      serviceEndpoint: s.serviceEndpoint,
      id: s.id,
      name: typeof s.name === "string" ? s.name : undefined,
    });
  }
  try {
    localStorage.setItem(cacheKey(registry, did), JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

function hrefKey(endpoint: DidService["serviceEndpoint"]): string | null {
  if (typeof endpoint === "string") {
    return endpoint.trim().toLowerCase().replace(/\/$/, "");
  }
  if (Array.isArray(endpoint) && typeof endpoint[0] === "string") {
    return endpoint[0].trim().toLowerCase().replace(/\/$/, "");
  }
  if (endpoint && typeof endpoint === "object") {
    const o = endpoint as Record<string, unknown>;
    for (const k of ["uri", "url", "href", "id", "email"]) {
      if (typeof o[k] === "string") {
        return (o[k] as string).trim().toLowerCase().replace(/\/$/, "");
      }
    }
  }
  return null;
}

function cachedToService(did: string, c: CachedSvc): DidService {
  return {
    id: c.id ?? `${did}#service-${c.attrKey}`,
    type: c.type,
    serviceEndpoint: c.serviceEndpoint,
    attrKey: c.attrKey,
    name: c.name,
  };
}

/** Drop cached link rows — chain is authoritative. */
export function resetDidServiceCache(
  registry: string,
  did: string,
  doc: DidDocument
) {
  writeCache(registry, did, doc.service ?? []);
  const chainKeys = (doc.service ?? [])
    .filter(isLinkService)
    .map((s) => s.attrKey!.toLowerCase());
  const recent = readRecentAttrKeys(did);
  for (const k of [...recent]) {
    if (!chainKeys.includes(k)) forgetRecentAttrKey(did, k);
  }
}

/**
 * Merge chain-resolved services with **this-session** writes only.
 *
 * v5 — do NOT restore the full localStorage link cache:
 * that resurrected deleted links when chain was empty/partial (lookback or
 * intentional clear). Only re-attach slotted keys marked `recent` that the
 * RPC may have missed right after a publish in this tab.
 */
export function mergeDidDocumentServices(
  registry: string,
  doc: DidDocument
): DidDocument {
  const fromChain = doc.service ?? [];
  const chainLinks = fromChain.filter(isLinkService);
  const cached = readCache(registry, doc.id);
  const recent = readRecentAttrKeys(doc.id);

  if (chainLinks.length === 0) {
    // Empty chain = authoritative (cleared or never published). Never revive
    // the full cache — only this-session / expected writes still in `recent`.
    const recentOnly = cached.filter((c) =>
      recent.has(c.attrKey.toLowerCase())
    );
    if (recentOnly.length === 0) {
      resetDidServiceCache(registry, doc.id, doc);
      return doc;
    }
    const nonLinks = fromChain.filter((s) => !isLinkService(s));
    const restored = recentOnly.map((c) => cachedToService(doc.id, c));
    const merged = [...nonLinks, ...restored];
    writeCache(registry, doc.id, merged);
    return { ...doc, service: merged };
  }

  const byKey = new Map<string, DidService>();
  const hrefs = new Set<string>();

  for (const s of fromChain) {
    if (s.attrKey) byKey.set(s.attrKey, s);
    else byKey.set(`${s.type}:${JSON.stringify(s.serviceEndpoint)}`, s);
    const h = hrefKey(s.serviceEndpoint);
    if (h) hrefs.add(h);
  }

  for (const c of cached) {
    if (!c.attrKey || byKey.has(c.attrKey)) continue;
    if (!recent.has(c.attrKey.toLowerCase())) continue;
    const h = hrefKey(c.serviceEndpoint);
    if (h && hrefs.has(h)) continue;
    byKey.set(c.attrKey, cachedToService(doc.id, c));
    if (h) hrefs.add(h);
  }

  const merged = [...byKey.values()];
  writeCache(registry, doc.id, merged);
  return { ...doc, service: merged };
}

export function rememberDidService(
  registry: string,
  did: string,
  svc: DidService
) {
  if (!svc.attrKey) return;
  markRecentAttrKey(did, svc.attrKey);
  const byKey = new Map<string, DidService>();
  for (const c of readCache(registry, did)) {
    byKey.set(c.attrKey, cachedToService(did, c));
  }
  byKey.set(svc.attrKey, svc);
  writeCache(registry, did, [...byKey.values()]);

  const sync = readDidSyncState(registry, did);
  if (sync) {
    const all = new Map(
      sync.services.map((c) => [c.attrKey, cachedToService(did, c)])
    );
    all.set(svc.attrKey, svc);
    writeDidSyncState(registry, did, BigInt(sync.syncedToBlock), [
      ...all.values(),
    ]);
  }
}

export function forgetDidService(
  registry: string,
  did: string,
  attrKey: string
) {
  forgetRecentAttrKey(did, attrKey);
  const next = readCache(registry, did).filter(
    (c) => c.attrKey.toLowerCase() !== attrKey.toLowerCase()
  );
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(cacheKey(registry, did), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  const sync = readDidSyncState(registry, did);
  if (sync) {
    writeDidSyncState(
      registry,
      did,
      BigInt(sync.syncedToBlock),
      sync.services
        .filter((c) => c.attrKey.toLowerCase() !== attrKey.toLowerCase())
        .map((c) => cachedToService(did, c))
    );
  }
}

export function syncStateToServices(
  did: string,
  state: SyncState
): DidService[] {
  return state.services.map((c) => cachedToService(did, c));
}

/**
 * After a publish batch: merge expected services into sync/cache so a warm
 * resolve cannot drop attrs we just confirmed (lookback / flaky getLogs).
 */
export function seedExpectedDidServices(
  registry: string,
  did: string,
  expected: DidService[]
) {
  if (!expected.length) return;
  const byKey = new Map<string, DidService>();
  const sync = readDidSyncState(registry, did);
  if (sync) {
    for (const c of sync.services) {
      byKey.set(c.attrKey, cachedToService(did, c));
    }
  } else {
    for (const c of readCache(registry, did)) {
      byKey.set(c.attrKey, cachedToService(did, c));
    }
  }
  for (const s of expected) {
    if (!s.attrKey) continue;
    byKey.set(s.attrKey, s);
    markRecentAttrKey(did, s.attrKey);
  }
  const merged = [...byKey.values()];
  const block = sync ? BigInt(sync.syncedToBlock) : 0n;
  writeDidSyncState(registry, did, block, merged);
}
