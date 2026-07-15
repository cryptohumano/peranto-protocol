import type { Address } from "viem";
import type { ActivityTx, PerantoClient } from "@peranto/sdk";
import {
  IndexedDbActivityStore,
  activityToStored,
  storedToActivity,
} from "@peranto/sdk";
import { DEFAULT_NETWORK } from "./deployment";

export const activityStore = new IndexedDbActivityStore();

export type ActivitySyncResult = {
  rows: ActivityTx[];
  added: number;
  fromCache: number;
  lastBlock: bigint;
  syncedAt: string;
};

/**
 * Load IndexedDB cache, fetch new chain activity for the user, merge & persist.
 * Incremental: after the first lookback, only scans from lastBlock+1.
 */
export async function syncUserActivity(
  account: Address,
  client?: PerantoClient,
  opts?: { forceFullLookback?: boolean }
): Promise<ActivitySyncResult> {
  const network = DEFAULT_NETWORK;
  const { getReadClient } = await import("./client");
  const c = client ?? (await getReadClient(network));

  const cached = await activityStore.list(account, network);
  const fromCache = cached.length;
  const cursor = await activityStore.getSync(account, network);
  const latest = await c.publicClient.getBlockNumber();

  let fromBlock: bigint | undefined;
  if (!opts?.forceFullLookback && cursor?.lastBlock) {
    const next = BigInt(cursor.lastBlock) + 1n;
    // If we fell far behind the default lookback window, restart from lookback
    // to avoid scanning millions of blocks in one go on Paseo.
    const lookbackFloor = latest > 80_000n ? latest - 80_000n : 0n;
    fromBlock = next < lookbackFloor ? lookbackFloor : next;
    if (fromBlock > latest) {
      return {
        rows: cached.map(storedToActivity),
        added: 0,
        fromCache,
        lastBlock: BigInt(cursor.lastBlock),
        syncedAt: cursor.syncedAt,
      };
    }
  }

  const fresh = await c.queryUserActivity(account, { fromBlock });
  const stored = fresh.map((tx) => activityToStored(tx, account, network));
  await activityStore.putMany(stored);

  const mergedMap = new Map<string, ReturnType<typeof activityToStored>>();
  for (const row of cached) mergedMap.set(row.id, row);
  for (const row of stored) mergedMap.set(row.id, row);
  const merged = [...mergedMap.values()].sort((a, b) => {
    const ba = BigInt(a.blockNumber);
    const bb = BigInt(b.blockNumber);
    if (ba === bb) return b.logIndex - a.logIndex;
    return ba > bb ? -1 : 1;
  });

  const syncedAt = new Date().toISOString();
  await activityStore.setSync({
    id: `${account.toLowerCase()}::${network}`,
    account: account.toLowerCase(),
    network,
    lastBlock: latest.toString(),
    syncedAt,
    rowCount: merged.length,
  });

  return {
    rows: merged.map(storedToActivity),
    added: stored.length,
    fromCache,
    lastBlock: latest,
    syncedAt,
  };
}

/** Instant read of what we already know offline. */
export async function loadCachedActivity(
  account: Address
): Promise<ActivityTx[]> {
  const rows = await activityStore.list(account, DEFAULT_NETWORK);
  return rows.map(storedToActivity);
}
