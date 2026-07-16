import type { DidDocument, DidService } from "@peranto/sdk";

type CachedSvc = {
  attrKey: string;
  type: string;
  serviceEndpoint: DidService["serviceEndpoint"];
  id?: string;
  name?: string;
};

const PAGE_TYPES = new Set(["PerantoPage"]);

function cacheKey(registry: string, did: string): string {
  return `peranto:did-svc-v2:${registry.toLowerCase()}:${did.toLowerCase()}`;
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

function isSlotted(attrKey: string): boolean {
  return attrKey.includes(".");
}

/** Drop cached link rows — chain is authoritative (fixes ghost links in /page). */
export function resetDidServiceCache(registry: string, did: string, doc: DidDocument) {
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
 * Merge chain-resolved services with local cache so RPC lookback gaps don’t drop links.
 *
 * Rules (v3):
 * - Chain always wins for the same attrKey
 * - If chain has **no** link services, never restore from cache (no ghosts)
 * - Otherwise restore only slotted keys published this session (`recent`) missing from chain
 */
export function mergeDidDocumentServices(
  registry: string,
  doc: DidDocument
): DidDocument {
  const fromChain = doc.service ?? [];
  const chainLinks = fromChain.filter(isLinkService);

  if (chainLinks.length === 0) {
    resetDidServiceCache(registry, doc.id, doc);
    return doc;
  }

  const cached = readCache(registry, doc.id);
  const recent = readRecentAttrKeys(doc.id);
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
    if (!isSlotted(c.attrKey)) continue;
    if (!recent.has(c.attrKey.toLowerCase())) continue;
    const h = hrefKey(c.serviceEndpoint);
    if (h && hrefs.has(h)) continue;
    byKey.set(c.attrKey, {
      id: c.id ?? `${doc.id}#service-${c.attrKey}`,
      type: c.type,
      serviceEndpoint: c.serviceEndpoint,
      attrKey: c.attrKey,
      name: c.name,
    });
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
    byKey.set(c.attrKey, {
      id: c.id ?? `${did}#service-${c.attrKey}`,
      type: c.type,
      serviceEndpoint: c.serviceEndpoint,
      attrKey: c.attrKey,
      name: c.name,
    });
  }
  byKey.set(svc.attrKey, svc);
  writeCache(registry, did, [...byKey.values()]);
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
}
