import type { DidDocument, DidService } from "@peranto/sdk";

type CachedSvc = {
  attrKey: string;
  type: string;
  serviceEndpoint: DidService["serviceEndpoint"];
  id?: string;
  name?: string;
};

function cacheKey(registry: string, did: string): string {
  // v2: stores display name; old v1 keys ignored (drops zombie bare attrs)
  return `peranto:did-svc-v2:${registry.toLowerCase()}:${did.toLowerCase()}`;
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

function writeCache(registry: string, did: string, services: DidService[]) {
  if (typeof localStorage === "undefined") return;
  const payload: CachedSvc[] = [];
  for (const s of services) {
    if (!s.attrKey || s.type === "PerantoPage") continue;
    if (s.attrKey.startsWith("PerantoPage")) continue;
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

/**
 * Merge chain-resolved services with local cache so RPC lookback gaps don’t drop links.
 *
 * Rules (v2):
 * - Chain wins for the same attrKey
 * - Cache may only restore *slotted* keys missing from chain (never bare `Website` / `LinkedDomains`)
 * - Don’t restore a cached endpoint if chain already has that URL under any key
 */
export function mergeDidDocumentServices(
  registry: string,
  doc: DidDocument
): DidDocument {
  const fromChain = doc.service ?? [];
  const cached = readCache(registry, doc.id);
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
    // Never resurrect legacy bare attrs — they overwrite each other on-chain
    // and linger in cache after clear/migrate to Type.slot
    if (!isSlotted(c.attrKey)) continue;
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
