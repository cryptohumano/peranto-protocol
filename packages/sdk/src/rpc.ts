import { fallback, http, type Transport } from "viem";

/**
 * Public Paseo eth-rpc endpoints, browser-first.
 *
 * `services.polkadothub-rpc.com` often 429s; those error responses omit CORS,
 * so the browser logs CORS + retry storms. Keep Parity (`eth-rpc-testnet`) first.
 */
export const PASEO_BROWSER_RPC_URLS = [
  "https://eth-rpc-testnet.polkadot.io/",
  "https://services.polkadothub-rpc.com/testnet/",
] as const;

const COOLDOWN_MS = 20_000;
let rpcCooldownUntil = 0;

async function pacedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (Date.now() < rpcCooldownUntil) {
    throw new Error("Peranto RPC cooldown after HTTP 429");
  }
  const res = await fetch(input, init);
  if (res.status === 429) {
    rpcCooldownUntil = Date.now() + COOLDOWN_MS;
  }
  return res;
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
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length ? out : [...PASEO_BROWSER_RPC_URLS];
}

/** Viem transport: low retries + failover, stop hammering on 429. */
export function createRpcTransport(
  rpcUrl?: string | readonly string[]
): Transport {
  const urls = uniqueUrls(rpcUrl);
  const transports = urls.map((url) =>
    http(url, {
      timeout: 15_000,
      retryCount: 1,
      retryDelay: 1_000,
      fetch: pacedFetch,
    })
  );
  if (transports.length === 1) return transports[0];
  return fallback(transports, { retryCount: 0 });
}
