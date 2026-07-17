import {
  type Abi,
  type Address,
  type GetContractEventsParameters,
  type Hex,
  type Log,
  keccak256,
  toBytes,
} from "viem";

/** Paseo / public RPCs often reject eth_getLogs from genesis or huge ranges. */
const DEFAULT_LOOKBACK = 80_000n;
const DEFAULT_CHUNK = 2_000n;
/** Parallel eth_getLogs — keep modest to avoid public-RPC 429s. */
const DEFAULT_CONCURRENCY = 8;

type Client = {
  getBlockNumber: () => Promise<bigint>;
  getContractEvents: (args: GetContractEventsParameters) => Promise<Log[]>;
};

export type ChunkedLogsResult = {
  logs: Log[];
  fromBlock: bigint;
  toBlock: bigint;
};

/**
 * Fetch contract events in chunks within a recent lookback window.
 * Avoids `fromBlock: 0` which Hub TestNet eth-rpc rejects as Invalid params.
 *
 * Pass `fromBlock` (absolute) for incremental sync after the first lookback.
 * Chunks run with bounded concurrency (default 8).
 */
export async function getContractEventsChunked(
  client: Client,
  params: {
    address: Address;
    abi: Abi;
    eventName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args?: any;
    lookback?: bigint;
    chunkSize?: bigint;
    /** Absolute start block (overrides lookback window). */
    fromBlock?: bigint;
    toBlock?: bigint;
    concurrency?: number;
  }
): Promise<Log[]> {
  const { logs } = await getContractEventsChunkedDetailed(client, params);
  return logs;
}

/** Same as `getContractEventsChunked` but also returns the scanned block range. */
export async function getContractEventsChunkedDetailed(
  client: Client,
  params: {
    address: Address;
    abi: Abi;
    eventName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args?: any;
    lookback?: bigint;
    chunkSize?: bigint;
    fromBlock?: bigint;
    toBlock?: bigint;
    concurrency?: number;
  }
): Promise<ChunkedLogsResult> {
  const lookback = params.lookback ?? DEFAULT_LOOKBACK;
  const chunkSize = params.chunkSize ?? DEFAULT_CHUNK;
  const concurrency = Math.max(1, params.concurrency ?? DEFAULT_CONCURRENCY);
  const latest = params.toBlock ?? (await client.getBlockNumber());
  const from =
    params.fromBlock !== undefined
      ? params.fromBlock
      : latest > lookback
        ? latest - lookback
        : 0n;
  if (from > latest) return { logs: [], fromBlock: from, toBlock: latest };

  const ranges: Array<{ from: bigint; to: bigint }> = [];
  for (let start = from; start <= latest; ) {
    const to = start + chunkSize - 1n > latest ? latest : start + chunkSize - 1n;
    ranges.push({ from: start, to });
    start = to + 1n;
  }

  const pieces: Log[][] = new Array(ranges.length);
  for (let i = 0; i < ranges.length; i += concurrency) {
    const batch = ranges.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (range) => {
        try {
          return await client.getContractEvents({
            address: params.address,
            abi: params.abi,
            eventName: params.eventName,
            args: params.args,
            fromBlock: range.from,
            toBlock: range.to,
          } as GetContractEventsParameters);
        } catch {
          try {
            return await client.getContractEvents({
              address: params.address,
              abi: params.abi,
              eventName: params.eventName,
              fromBlock: range.from,
              toBlock: range.to,
            } as GetContractEventsParameters);
          } catch {
            return [] as Log[];
          }
        }
      })
    );
    for (let j = 0; j < results.length; j++) {
      pieces[i + j] = results[j];
    }
  }

  return {
    logs: pieces.flat(),
    fromBlock: from,
    toBlock: latest,
  };
}

/** Default window for plain native transfers (block walk is heavier than getLogs). */
export const NATIVE_TRANSFER_LOOKBACK = 2_500n;
const NATIVE_CONCURRENCY = 16;

type BlockClient = {
  getBlockNumber: () => Promise<bigint>;
  getBlock: (args: {
    blockNumber: bigint;
    includeTransactions?: boolean;
  }) => Promise<{
    number: bigint | null;
    transactions: Array<
      | Hex
      | {
          hash: Hex;
          from: Address;
          to: Address | null;
          value: bigint;
          input?: Hex;
          transactionIndex?: number | null;
        }
    >;
  }>;
};

/**
 * Scan recent blocks for plain native transfers (empty calldata, value > 0)
 * involving `account` as from (send) or to (receive).
 * Skips contract calls (tips/contribute already covered by event logs).
 */
export async function scanNativeTransfers(
  client: BlockClient,
  account: Address,
  opts?: { fromBlock?: bigint; toBlock?: bigint; lookback?: bigint }
): Promise<
  Array<{
    direction: "send" | "receive";
    txHash: Hex;
    blockNumber: bigint;
    transactionIndex: number;
    counterpart: Address;
    valueWei: bigint;
  }>
> {
  const lookback = opts?.lookback ?? NATIVE_TRANSFER_LOOKBACK;
  const latest = opts?.toBlock ?? (await client.getBlockNumber());
  let from =
    opts?.fromBlock !== undefined
      ? opts.fromBlock
      : latest > lookback
        ? latest - lookback
        : 0n;
  if (from > latest) return [];

  const me = account.toLowerCase();
  const out: Array<{
    direction: "send" | "receive";
    txHash: Hex;
    blockNumber: bigint;
    transactionIndex: number;
    counterpart: Address;
    valueWei: bigint;
  }> = [];

  const blocks: bigint[] = [];
  for (let b = from; b <= latest; b++) blocks.push(b);

  for (let i = 0; i < blocks.length; i += NATIVE_CONCURRENCY) {
    const slice = blocks.slice(i, i + NATIVE_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (blockNumber) => {
        try {
          return await client.getBlock({
            blockNumber,
            includeTransactions: true,
          });
        } catch {
          return null;
        }
      })
    );
    for (const block of results) {
      if (!block?.transactions?.length) continue;
      const bn = block.number ?? 0n;
      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        const input = (tx.input ?? "0x").toLowerCase();
        if (input !== "0x" && input !== "0x0") continue;
        if (!tx.value || tx.value === 0n) continue;
        if (!tx.to) continue;
        const fromAddr = tx.from.toLowerCase();
        const toAddr = tx.to.toLowerCase();
        const idx = Number(tx.transactionIndex ?? 0);
        if (fromAddr === me) {
          out.push({
            direction: "send",
            txHash: tx.hash,
            blockNumber: bn,
            transactionIndex: idx,
            counterpart: tx.to,
            valueWei: tx.value,
          });
        } else if (toAddr === me) {
          out.push({
            direction: "receive",
            txHash: tx.hash,
            blockNumber: bn,
            transactionIndex: idx,
            counterpart: tx.from,
            valueWei: tx.value,
          });
        }
      }
    }
  }
  return out;
}

/** Same as NameRegistry._validateAndHash (keccak256 of UTF-8 bytes). */
export function labelHashOf(label: string): Hex {
  return keccak256(toBytes(label));
}
