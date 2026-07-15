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

type Client = {
  getBlockNumber: () => Promise<bigint>;
  getContractEvents: (args: GetContractEventsParameters) => Promise<Log[]>;
};

/**
 * Fetch contract events in chunks within a recent lookback window.
 * Avoids `fromBlock: 0` which Hub TestNet eth-rpc rejects as Invalid params.
 *
 * Pass `fromBlock` (absolute) for incremental sync after the first lookback.
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
  }
): Promise<Log[]> {
  const lookback = params.lookback ?? DEFAULT_LOOKBACK;
  const chunkSize = params.chunkSize ?? DEFAULT_CHUNK;
  const latest = params.toBlock ?? (await client.getBlockNumber());
  let from =
    params.fromBlock !== undefined
      ? params.fromBlock
      : latest > lookback
        ? latest - lookback
        : 0n;
  if (from > latest) return [];
  const out: Log[] = [];

  while (from <= latest) {
    const to = from + chunkSize - 1n > latest ? latest : from + chunkSize - 1n;
    try {
      const piece = await client.getContractEvents({
        address: params.address,
        abi: params.abi,
        eventName: params.eventName,
        args: params.args,
        fromBlock: from,
        toBlock: to,
      } as GetContractEventsParameters);
      out.push(...piece);
    } catch {
      try {
        const piece = await client.getContractEvents({
          address: params.address,
          abi: params.abi,
          eventName: params.eventName,
          fromBlock: from,
          toBlock: to,
        } as GetContractEventsParameters);
        out.push(...piece);
      } catch {
        /* skip broken chunk */
      }
    }
    from = to + 1n;
  }
  return out;
}

/** Same as NameRegistry._validateAndHash (keccak256 of UTF-8 bytes). */
export function labelHashOf(label: string): Hex {
  return keccak256(toBytes(label));
}
