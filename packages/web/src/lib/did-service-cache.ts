import type { DidDocument, DidService } from "@peranto/sdk";

type CachedSvc = {
  attrKey: string;
  type: string;
  serviceEndpoint: DidService["serviceEndpoint"];
  id?: string;
};

function cacheKey(registry: string, did: string): string {
  return `peranto:did-svc-v1:${registry.toLowerCase()}:${did.toLowerCase()}`;
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
    });
  }
  try {
    localStorage.setItem(cacheKey(registry, did), JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

/** Merge chain-resolved services with local cache so RPC lookback gaps don’t drop links. */
export function mergeDidDocumentServices(
  registry: string,
  doc: DidDocument
): DidDocument {
  const fromChain = doc.service ?? [];
  const cached = readCache(registry, doc.id);
  const byKey = new Map<string, DidService>();

  for (const c of cached) {
    byKey.set(c.attrKey, {
      id: c.id ?? `${doc.id}#service-${c.attrKey}`,
      type: c.type,
      serviceEndpoint: c.serviceEndpoint,
      attrKey: c.attrKey,
    });
  }
  // Chain wins on conflict
  for (const s of fromChain) {
    if (s.attrKey) byKey.set(s.attrKey, s);
    else byKey.set(`${s.type}:${JSON.stringify(s.serviceEndpoint)}`, s);
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
