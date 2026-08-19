/**
 * Isolated content script: bridges page ↔ Aura service worker.
 * Fetches same-origin well-known DID configuration for sensitive APIs.
 */
import { wellKnownDidConfigurationUrls } from "@peranto/sdk";

const CHANNEL = "aura-peranto";

const SAFE_PERANTO_ACTIONS = new Set([
  "did.resolve",
  "name.resolve",
  "vc.verify",
  "rpc.ping",
  "wallet.addresses",
  "sign.verify",
  "attester.isAuthorized",
]);

let cachedConfig: { key: string; value: unknown } | null = null;

function needsDomainLinkage(method: string, params: unknown[] = []): boolean {
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

function isDidConfiguration(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as { linked_dids?: unknown }).linked_dids)
  );
}

function discoverUrls(origin: string): string[] {
  const href = document
    .querySelector('link[rel="did-configuration"]')
    ?.getAttribute("href");
  const urls = wellKnownDidConfigurationUrls(origin, {
    pathname: window.location.pathname,
    pageHref: window.location.href,
  });
  if (href) {
    try {
      const abs = new URL(href, window.location.href).href;
      if (!urls.includes(abs)) urls.unshift(abs);
    } catch {
      /* ignore */
    }
  }
  return urls;
}

async function fetchDidConfiguration(
  origin: string
): Promise<unknown | undefined> {
  const key = `${origin}|${window.location.pathname}`;
  if (cachedConfig?.key === key) return cachedConfig.value;

  for (const url of discoverUrls(origin)) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        credentials: "omit",
      });
      if (!res.ok) continue;
      const json: unknown = await res.json();
      if (!isDidConfiguration(json)) continue;
      cachedConfig = { key, value: json };
      return json;
    } catch {
      /* try next candidate (GitHub Pages subpath, etc.) */
    }
  }
  return undefined;
}

window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (!data || data.channel !== CHANNEL || data.direction !== "inpage→cs") {
    return;
  }

  void (async () => {
    const origin = window.location.origin;
    const method = String(data.method ?? "");
    const params = Array.isArray(data.params) ? data.params : [];
    let didConfiguration: unknown | undefined;
    if (needsDomainLinkage(method, params)) {
      didConfiguration = await fetchDidConfiguration(origin);
    }

    chrome.runtime.sendMessage(
      {
        type: "PROVIDER_REQUEST",
        id: data.id,
        method,
        params,
        origin,
        pathname: window.location.pathname,
        pageHref: window.location.href,
        didConfiguration,
      },
      (response) => {
        const err = chrome.runtime.lastError;
        window.postMessage(
          {
            channel: CHANNEL,
            direction: "cs→inpage",
            id: data.id,
            result: !err && response?.ok ? response.data : undefined,
            error: err
              ? err.message
              : response?.ok
                ? undefined
                : (response?.error ?? "Aura error"),
          },
          "*"
        );
      }
    );
  })();
});
