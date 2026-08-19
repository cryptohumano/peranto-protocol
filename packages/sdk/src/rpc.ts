import { fallback, http, type Transport } from "viem";

/**
 * Public Paseo eth-rpc for **browsers**.
 *
 * Do not include `services.polkadothub-rpc.com`: 429 responses omit CORS and
 * viem fallback + getLogs turns that into a console flood.
 */
export const PASEO_BROWSER_RPC_URLS = [
  "https://eth-rpc-testnet.polkadot.io/",
] as const;

const HUB_RPC_HOST = "polkadothub-rpc.com";
const COOLDOWN_MS = 30_000;
let rpcCooldownUntil = 0;

function isHubRpc(url: string): boolean {
  return url.includes(HUB_RPC_HOST);
}

async function pacedFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  if (Date.now() < rpcCooldownUntil) {
    throw new Error("Peranto RPC cooldown after rate limit / CORS failure");
  }
  try {
    const res = await fetch(input, init);
    if (res.status === 429) {
      rpcCooldownUntil = Date.now() + COOLDOWN_MS;
    }
    return res;
  } catch (err) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (isHubRpc(url)) {
      rpcCooldownUntil = Date.now() + COOLDOWN_MS;
    }
    throw err;
  }
}

function uniqueUrls(rpcUrl?: string | readonly string[]): string[] {
  const raw = Array.isArray(rpcUrl)
    ? rpcUrl
    : rpcUrl
      ? [rpcUrl]
      : [...PASEO_BROWSER_RPC_URLS];
  const out: string[] = [];
  for (const u of raw) {
    const t = u?.trim();
    if (!t || isHubRpc(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out.length ? out : [...PASEO_BROWSER_RPC_URLS];
}

/** Viem transport: Parity only in browser, low retries, 429 cooldown. */
export function createRpcTransport(
  rpcUrl?: string | readonly string[]
): Transport {
  const urls = uniqueUrls(rpcUrl);
  const transports = urls.map((url) =>
    http(url, {
      timeout: 15_000,
      retryCount: 0,
      fetchFn: pacedFetch,
    })
  );
  if (transports.length === 1) return transports[0];
  return fallback(transports, { retryCount: 0 });
}
