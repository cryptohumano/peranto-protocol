/**
 * Isolated content script: bridges page ↔ Aura service worker.
 * Fetches same-origin well-known DID configuration for sensitive APIs.
 */
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

async function fetchDidConfiguration(
  origin: string
): Promise<unknown | undefined> {
  try {
    const res = await fetch(`${origin}/.well-known/did-configuration.json`, {
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
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
