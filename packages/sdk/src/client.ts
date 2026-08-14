import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  getContract,
  http,
  isAddress,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  hardhat,
} from "viem/chains";
import {
  attesterRegistryAbi,
  credentialStatusAbi,
  didRegistryAbi,
  disCOFactoryAbi,
  disCONodeAbi,
  erc20PaymentAbi,
  nameRegistryAbi,
  NATIVE_TOKEN,
  protocolTreasuryAbi,
  schemaRegistryAbi,
} from "./abi";
export { NATIVE_TOKEN } from "./abi";
import {
  NETWORK_CHAIN_ID,
  DID_SERVICE_DEFAULT_VALIDITY,
  DELEGATE_TYPE_SVC,
  attributeNameFromBytes32,
  attributeNameToBytes32,
  decodeDidPurposeVmValue,
  decodeDidServiceValue,
  delegateTypeFromBytes32,
  delegateTypeToBytes32,
  encodeDidPurposeVmValue,
  encodeDidServiceValue,
  formatDid,
  isServiceAttributeName,
  isVmAttributeName,
  parseDid,
  resolveDidDocument,
  schemaIdFromKey,
  serviceAttributeName,
  serviceAttrKeyFromAttributeName,
  serviceSlotFromAttributeName,
  serviceTypeFromAttributeName,
  vmAttributeName,
  vmRelationshipFromAttributeName,
  type DidDelegate,
  type DidDocument,
  type DidPurposeVm,
  type DidService,
  type DidVmRelationship,
  type PerantoNetwork,
} from "./did";
import {
  issueJwtCredential,
  verifyEcoTestJwt,
  type EcoTestClaims,
  type IssuedCredential,
} from "./vc";
import {
  createDidConfigurationForOrigin,
  verifyDomainLinkage,
  type DomainLinkageVerifyResult,
  type VerifyDomainLinkageOptions,
} from "./domain-linkage";
import {
  derivePurposeKeys,
  type PurposeKeys,
} from "./wallet";
import {
  getContractEventsChunked,
  getContractEventsChunkedDetailed,
  labelHashOf,
  scanNativeTransfers,
} from "./logs";
import {
  ACTIVITY_TX_LABELS,
  type ActivityTx,
  type ActivityTxType,
} from "./activity";

export type ContractAddresses = {
  DIDRegistry: Address;
  SchemaRegistry: Address;
  AttesterRegistry: Address;
  CredentialStatusRegistry: Address;
  NameRegistry?: Address;
  ProtocolTreasury?: Address;
  DisCOFactory?: Address;
  PerantoNode?: Address | null;
  EcosystemLabNode?: Address | null;
  ComplianceZkVerifier?: Address;
};

/** Options for log-based DID service reconstruction. */
export type CollectDidServicesOpts = {
  lookback?: bigint;
  chunkSize?: bigint;
  fromBlock?: bigint;
  toBlock?: bigint;
  concurrency?: number;
  /**
   * Prior active services (incremental sync). Merged with new logs in the
   * `[fromBlock, toBlock]` window — use with `fromBlock = lastSynced + 1`.
   */
  seedServices?: DidService[];
  /**
   * Never fall back to `eth_getLogs`. Use for public pages (linktr33):
   * v0.2 storage only — empty Document if the identity has no on-chain attrs.
   */
  storageOnly?: boolean;
};

export type CollectDidServicesResult = {
  services: DidService[];
  purposeVms: DidPurposeVm[];
  syncedToBlock: bigint;
};

const paseoChain = {
  id: 420420417,
  name: "Polkadot Hub TestNet",
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://eth-rpc-testnet.polkadot.io/"] },
  },
} as const;

function chainFor(network: PerantoNetwork) {
  switch (network) {
    case "paseo":
      return paseoChain;
    case "base":
      return base;
    case "baseSepolia":
      return baseSepolia;
    case "arbitrum":
      return arbitrum;
    case "arbitrumSepolia":
      return arbitrumSepolia;
    case "hardhat":
    case "localhost":
    default:
  return hardhat;
  }
}

export class PerantoClient {
  readonly network: PerantoNetwork;
  readonly addresses: ContractAddresses;
  /** Typed loosely to avoid duplicate-viem TS2719 across workspaces. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly walletClient?: any;
  private readonly privateKey?: Hex;
  /** BIP39 — used to derive assertion / purpose keys when issuing VCs. */
  private readonly mnemonic?: string;
  /** Optional override for JWT-VC ES256K (defaults to derived assertion or controller). */
  private readonly assertionPrivateKey?: Hex;

  constructor(opts: {
    network: PerantoNetwork;
    addresses: ContractAddresses;
    rpcUrl?: string;
    privateKey?: Hex;
    mnemonic?: string;
    assertionPrivateKey?: Hex;
  }) {
    this.network = opts.network;
    this.addresses = opts.addresses;
    this.privateKey = opts.privateKey;
    this.mnemonic = opts.mnemonic?.trim();
    this.assertionPrivateKey = opts.assertionPrivateKey;
    const chain = chainFor(opts.network);
    const transport = http(opts.rpcUrl);

    this.publicClient = createPublicClient({
      chain,
      transport,
    });

    if (opts.privateKey) {
      const account = privateKeyToAccount(opts.privateKey);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport,
      });
    }
  }

  /**
   * Hub TestNet eth-rpc often rejects EIP-1559 txs from newly funded accounts
   * (`Invalid Transaction`). Prefer legacy `gasPrice` on paseo.
   */
  private async paseoFeeFields(): Promise<
    | { type: "legacy"; gasPrice: bigint }
    | Record<string, never>
  > {
    if (this.network !== "paseo") return {};
    const gasPrice = await this.publicClient.getGasPrice();
    return { type: "legacy", gasPrice };
  }

  private async writeContract(
    params: Parameters<NonNullable<typeof this.walletClient>["writeContract"]>[0]
  ) {
    this.requireWallet();
    const fees = await this.paseoFeeFields();
    const base = { ...(params as object) } as Record<string, unknown>;
    Object.assign(base, fees);
    // Avoid huge fixed gas caps: at ~1000 gwei, oversized gas locks more PAS
    // than a freshly funded demo wallet holds (Invalid Transaction).
    if (this.network === "paseo" && base.gas == null) {
      try {
        const estimated = await this.publicClient.estimateContractGas({
          ...(params as object),
          account: this.walletClient!.account!,
        } as never);
        base.gas = (estimated * 15n) / 10n; // +50% headroom for PVM
      } catch {
        /* let viem estimate at send time */
      }
    }
    return this.walletClient!.writeContract(base as never);
  }

  private async sendTransaction(
    params: Parameters<NonNullable<typeof this.walletClient>["sendTransaction"]>[0]
  ) {
    this.requireWallet();
    const fees = await this.paseoFeeFields();
    const base = { ...(params as object) } as Record<string, unknown>;
    Object.assign(base, fees);
    return this.walletClient!.sendTransaction(base as never);
  }

  get accountAddress(): Address | undefined {
    return this.walletClient?.account?.address;
  }

  async resolveDid(
    did: string,
    opts?: CollectDidServicesOpts
  ): Promise<DidDocument> {
    const { address } = parseDid(did);
    const [deactivated, collected, delegates] = await Promise.all([
      this.publicClient.readContract({
        address: this.addresses.DIDRegistry,
        abi: didRegistryAbi,
        functionName: "deactivated",
        args: [address],
      }),
      this.collectDidServices(did, address, opts),
      this.collectDidDelegates(address),
    ]);
    return resolveDidDocument(
      did,
      Boolean(deactivated),
      collected.services,
      delegates,
      collected.purposeVms
    );
  }

  /** Active delegates from on-chain enumerable list (method v0.2). */
  async collectDidDelegates(identity: Address): Promise<DidDelegate[]> {
    try {
      const count = (await this.publicClient.readContract({
        address: this.addresses.DIDRegistry,
        abi: didRegistryAbi,
        functionName: "delegateCount",
        args: [identity],
      })) as bigint;
      if (count === 0n) return [];
      const now = Math.floor(Date.now() / 1000);
      const n = Number(count);
      const rows = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          this.publicClient.readContract({
            address: this.addresses.DIDRegistry,
            abi: didRegistryAbi,
            functionName: "delegateAt",
            args: [identity, BigInt(i)],
          }) as Promise<[Hex, Address, bigint]>
        )
      );
      const out: DidDelegate[] = [];
      for (const row of rows) {
        const validTo = Number(row[2]);
        if (validTo <= now) continue;
        out.push({
          delegateType: delegateTypeFromBytes32(row[0]),
          address: getAddress(row[1]),
          validTo,
        });
      }
      return out;
    } catch {
      // Pre-v0.2 registry without enumerable delegates
      return [];
    }
  }

  /**
   * Prefer on-chain attribute storage (v0.2). Fall back to event lookback when
   * storage is unsupported (legacy registry), unless `storageOnly`.
   */
  async collectDidServices(
    did: string,
    identity: Address,
    opts?: CollectDidServicesOpts
  ): Promise<CollectDidServicesResult> {
    const fromStorage = await this.collectDidServicesFromStorage(did, identity);
    if (fromStorage?.supported) {
      let syncedToBlock = 0n;
      if (!opts?.storageOnly) {
        try {
          syncedToBlock = await this.publicClient.getBlockNumber();
        } catch {
          syncedToBlock = 0n;
        }
      }
      return {
        services: fromStorage.services,
        purposeVms: fromStorage.purposeVms,
        syncedToBlock,
      };
    }
    if (opts?.storageOnly) {
      return { services: [], purposeVms: [], syncedToBlock: 0n };
    }
    return this.collectDidServicesFromEvents(did, identity, opts);
  }

  private async collectDidServicesFromStorage(
    did: string,
    identity: Address
  ): Promise<{
    services: DidService[];
    purposeVms: DidPurposeVm[];
    supported: boolean;
  } | null> {
    try {
      const count = (await this.publicClient.readContract({
        address: this.addresses.DIDRegistry,
        abi: didRegistryAbi,
        functionName: "attributeCount",
        args: [identity],
      })) as bigint;
      const now = Math.floor(Date.now() / 1000);
      const out: DidService[] = [];
      const purposeVms: DidPurposeVm[] = [];
      if (count === 0n) {
        return { services: out, purposeVms, supported: true };
      }

      const n = Number(count);
      // Parallel eth_calls (avoids sequential round-trips; no Multicall3 dependency).
      const names = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          this.publicClient.readContract({
            address: this.addresses.DIDRegistry,
            abi: didRegistryAbi,
            functionName: "attributeNameAt",
            args: [identity, BigInt(i)],
          }) as Promise<Hex>
        )
      );

      const interesting: { name: Hex; nameStr: string; kind: "svc" | "vm" }[] =
        [];
      for (const name of names) {
        const nameStr = attributeNameFromBytes32(name);
        if (isServiceAttributeName(nameStr)) {
          interesting.push({ name, nameStr, kind: "svc" });
        } else if (isVmAttributeName(nameStr)) {
          interesting.push({ name, nameStr, kind: "vm" });
        }
      }

      if (interesting.length === 0) {
        return { services: out, purposeVms, supported: true };
      }

      const rows = await Promise.all(
        interesting.map(
          (item) =>
            this.publicClient.readContract({
              address: this.addresses.DIDRegistry,
              abi: didRegistryAbi,
              functionName: "getAttribute",
              args: [identity, item.name],
            }) as Promise<[Hex, bigint, boolean]>
        )
      );

      for (let i = 0; i < interesting.length; i++) {
        const item = interesting[i]!;
        const [value, validTo, active] = rows[i]!;
        if (!active || Number(validTo) <= now) continue;
        if (item.kind === "svc") {
          const type = serviceTypeFromAttributeName(item.nameStr);
          const attrKey = serviceAttrKeyFromAttributeName(item.nameStr);
          const svc = decodeDidServiceValue(value, type, did);
          if (svc) {
            const slot = serviceSlotFromAttributeName(item.nameStr);
            out.push({
              ...svc,
              attrKey,
              name: svc.name?.trim() || slot || undefined,
            });
          }
        } else {
          const rel = vmRelationshipFromAttributeName(item.nameStr);
          if (!rel) continue;
          const vm = decodeDidPurposeVmValue(value, rel, did);
          if (vm) purposeVms.push(vm);
        }
      }
      return { services: out, purposeVms, supported: true };
    } catch {
      return null;
    }
  }

  /** Rebuild services from `DIDAttributeChanged` events (legacy / fallback). */
  async collectDidServicesFromEvents(
    did: string,
    identity: Address,
    opts?: CollectDidServicesOpts
  ): Promise<CollectDidServicesResult> {
    const cold = opts?.fromBlock === undefined;
    const { logs, toBlock } = await getContractEventsChunkedDetailed(
      this.publicClient,
      {
        address: this.addresses.DIDRegistry,
        abi: didRegistryAbi,
        eventName: "DIDAttributeChanged",
        args: { identity },
        lookback: opts?.lookback ?? (cold ? 500_000n : undefined),
        chunkSize: opts?.chunkSize ?? 4_000n,
        fromBlock: opts?.fromBlock,
        toBlock: opts?.toBlock,
        concurrency: opts?.concurrency ?? 8,
      }
    );

    const ordered = [...logs].sort((a, b) => {
      const ba = a.blockNumber ?? 0n;
      const bb = b.blockNumber ?? 0n;
      if (ba !== bb) return ba < bb ? -1 : 1;
      const la = a.logIndex ?? 0;
      const lb = b.logIndex ?? 0;
      return la - lb;
    });

    const now = Math.floor(Date.now() / 1000);
    const latest = new Map<string, { value: Hex; validTo: number }>();

    if (!cold && opts?.seedServices?.length) {
      for (const s of opts.seedServices) {
        if (!s.attrKey) continue;
        const nameStr = `did/svc/${s.attrKey}`;
        const payload = encodeDidServiceValue({
          id: s.id,
          type: s.type,
          serviceEndpoint: s.serviceEndpoint,
          name: s.name,
        });
        latest.set(nameStr, {
          value: payload,
          validTo: now + 60 * 60 * 24 * 365 * 100,
        });
      }
    }

    for (const log of ordered) {
      const args = (log as { args?: { name?: Hex; value?: Hex; validTo?: bigint } })
        .args;
      if (!args?.name || args.value === undefined || args.validTo === undefined) {
        continue;
      }
      const nameStr = attributeNameFromBytes32(args.name);
      if (!isServiceAttributeName(nameStr) && !isVmAttributeName(nameStr)) continue;
      latest.set(nameStr, {
        value: args.value,
        validTo: Number(args.validTo),
      });
    }

    const out: DidService[] = [];
    const purposeVms: DidPurposeVm[] = [];
    for (const [nameStr, entry] of latest) {
      if (entry.validTo <= now) continue;
      if (isServiceAttributeName(nameStr)) {
        const type = serviceTypeFromAttributeName(nameStr);
        const attrKey = serviceAttrKeyFromAttributeName(nameStr);
        const svc = decodeDidServiceValue(entry.value, type, did);
        if (svc) {
          const slot = serviceSlotFromAttributeName(nameStr);
          out.push({
            ...svc,
            attrKey,
            name: svc.name?.trim() || slot || undefined,
          });
        }
      } else {
        const rel = vmRelationshipFromAttributeName(nameStr);
        if (!rel) continue;
        const vm = decodeDidPurposeVmValue(entry.value, rel, did);
        if (vm) purposeVms.push(vm);
      }
    }
    return { services: out, purposeVms, syncedToBlock: toBlock };
  }

  async addDelegate(opts: {
    identity?: Address;
    delegateType: string;
    delegate: Address;
    validitySeconds: bigint;
  }) {
    this.requireWallet();
    const identity = opts.identity ?? this.accountAddress!;
    const hash = await this.writeContract({
      address: this.addresses.DIDRegistry,
      abi: didRegistryAbi,
      functionName: "addDelegate",
      args: [
        identity,
        delegateTypeToBytes32(opts.delegateType),
        opts.delegate,
        opts.validitySeconds,
      ],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async revokeDelegate(opts: {
    identity?: Address;
    delegateType: string;
    delegate: Address;
  }) {
    this.requireWallet();
    const identity = opts.identity ?? this.accountAddress!;
    const hash = await this.writeContract({
      address: this.addresses.DIDRegistry,
      abi: didRegistryAbi,
      functionName: "revokeDelegate",
      args: [
        identity,
        delegateTypeToBytes32(opts.delegateType),
        opts.delegate,
      ],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async validDelegate(
    identity: Address,
    delegateType: string,
    delegate: Address
  ): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.addresses.DIDRegistry,
      abi: didRegistryAbi,
      functionName: "validDelegate",
      args: [identity, delegateTypeToBytes32(delegateType), delegate],
    })) as boolean;
  }

  /** Convenience: grant `svc` scope so `delegate` can update did/svc/* attributes. */
  async addServiceDelegate(
    delegate: Address,
    validitySeconds: bigint = DID_SERVICE_DEFAULT_VALIDITY
  ) {
    return this.addDelegate({
      delegateType: DELEGATE_TYPE_SVC,
      delegate,
      validitySeconds,
    });
  }

  /**
   * Set a DID attribute. Defaults to the session account as `identity`.
   * A valid `svc` delegate may pass the controller identity to update `did/svc/*`.
   */
  async setDidAttribute(
    name: string | Hex,
    value: Hex,
    validitySeconds: bigint = DID_SERVICE_DEFAULT_VALIDITY,
    identity?: Address
  ) {
    this.requireWallet();
    const id = identity ?? this.accountAddress!;
    const nameBytes =
      typeof name === "string" && !name.startsWith("0x")
        ? attributeNameToBytes32(name)
        : (name as Hex);
    const hash = await this.writeContract({
      address: this.addresses.DIDRegistry,
      abi: didRegistryAbi,
      functionName: "setAttribute",
      args: [id, nameBytes, value, validitySeconds],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Publish or refresh a DID Document service endpoint. */
  async setDidService(opts: {
    type: string;
    /** Optional slot so several endpoints share the same type (e.g. `github`, `web`). */
    key?: string;
    serviceEndpoint: string | string[] | Record<string, unknown>;
    id?: string;
    /** Display label on public page (defaults to key/slot). */
    name?: string;
    validitySeconds?: bigint;
    /**
     * Target identity (default: session account).
     * Required when a `svc` delegate updates another DID's services.
     */
    identity?: Address;
  }) {
    const target = opts.identity ?? this.accountAddress!;
    const did = formatDid(this.network, target);
    const attrKey = opts.key?.trim()
      ? `${opts.type.trim()}.${opts.key.trim()}`
      : opts.type.trim();
    const display =
      opts.name?.trim() || opts.key?.trim() || undefined;
    const payload = encodeDidServiceValue({
      id: opts.id ?? `${did}#service-${attrKey}`,
      type: opts.type,
      serviceEndpoint: opts.serviceEndpoint,
      name: display,
    });
    return this.setDidAttribute(
      serviceAttributeName(opts.type, opts.key),
      payload,
      opts.validitySeconds ?? DID_SERVICE_DEFAULT_VALIDITY,
      target
    );
  }

  /** Expire a service attribute (validTo = now). Pass `key` if you used a slot. */
  async clearDidService(type: string, key?: string) {
    return this.setDidAttribute(serviceAttributeName(type, key), "0x", 0n);
  }

  /** Clear by the stored `attrKey` (`LinkedDomains` or `LinkedDomains.github`). */
  async clearDidServiceByAttrKey(attrKey: string) {
    const dot = attrKey.indexOf(".");
    if (dot === -1) return this.clearDidService(attrKey);
    return this.clearDidService(attrKey.slice(0, dot), attrKey.slice(dot + 1));
  }

  /**
   * Publish purpose verification methods (`did/vm/*`) from derived keys.
   * Owner-only; three sequential `setAttribute` txs (auth, assertion, keyAgreement).
   */
  async publishPurposeKeys(
    keys: PurposeKeys,
    validitySeconds: bigint = DID_SERVICE_DEFAULT_VALIDITY
  ): Promise<{ hashes: Hex[]; did: string }> {
    this.requireWallet();
    const did = formatDid(this.network, this.accountAddress!);
    const chainId = NETWORK_CHAIN_ID[this.network];
    const hashes: Hex[] = [];

    const authPayload = encodeDidPurposeVmValue({
      id: `${did}#${keys.authentication.fragment}`,
      type: "EcdsaSecp256k1RecoveryMethod2020",
      blockchainAccountId: `eip155:${chainId}:${keys.authentication.address}`,
    });
    hashes.push(
      await this.setDidAttribute(
        vmAttributeName("authentication"),
        authPayload,
        validitySeconds
      )
    );

    const assertPayload = encodeDidPurposeVmValue({
      id: `${did}#${keys.assertion.fragment}`,
      type: "EcdsaSecp256k1RecoveryMethod2020",
      blockchainAccountId: `eip155:${chainId}:${keys.assertion.address}`,
    });
    hashes.push(
      await this.setDidAttribute(
        vmAttributeName("assertionMethod"),
        assertPayload,
        validitySeconds
      )
    );

    const kaPayload = encodeDidPurposeVmValue({
      id: `${did}#${keys.keyAgreement.fragment}`,
      type: "X25519KeyAgreementKey2020",
      publicKeyJwk: keys.keyAgreement.publicKeyJwk,
    });
    hashes.push(
      await this.setDidAttribute(
        vmAttributeName("keyAgreement"),
        kaPayload,
        validitySeconds
      )
    );

    return { hashes, did };
  }

  /** Derive purpose keys from mnemonic and publish on-chain. */
  async publishPurposeKeysFromMnemonic(
    mnemonic: string,
    validitySeconds?: bigint
  ) {
    const keys = await derivePurposeKeys(mnemonic, this.network);
    if (
      keys.controller.address.toLowerCase() !==
      this.accountAddress!.toLowerCase()
    ) {
      throw new Error(
        "Mnemonic no corresponde al controller de la sesión (path m/44'/60'/0'/0/0)"
      );
    }
    return this.publishPurposeKeys(keys, validitySeconds);
  }

  async clearPurposeVm(relationship: DidVmRelationship) {
    return this.setDidAttribute(vmAttributeName(relationship), "0x", 0n);
  }

  async deactivateDid(identity?: Address) {
    this.requireWallet();
    const id = identity ?? this.accountAddress!;
    const hash = await this.writeContract({
      address: this.addresses.DIDRegistry,
      abi: didRegistryAbi,
      functionName: "deactivate",
      args: [id],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async releaseName(label: string) {
    this.requireWallet();
    if (!this.addresses.NameRegistry) {
      throw new Error("NameRegistry not in deployment");
    }
    const hash = await this.writeContract({
      address: this.addresses.NameRegistry,
      abi: nameRegistryAbi,
      functionName: "release",
      args: [label],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async registerSchema(schemaKey: string, schemaBody: string, uri: string) {
    this.requireWallet();
    const schemaId = schemaIdFromKey(schemaKey);
    const schemaHash = schemaIdFromKey(schemaBody);
    const hash = await this.writeContract({
      address: this.addresses.SchemaRegistry,
      abi: schemaRegistryAbi,
      functionName: "registerSchema",
      args: [schemaId, schemaHash, uri],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { schemaId, schemaHash, txHash: hash };
  }

  /** Ensure ERC-20 allowance for `spender`; no-op for native token. */
  async ensureAllowance(
    token: Address,
    spender: Address,
    amount: bigint
  ): Promise<Hex | undefined> {
    if (token.toLowerCase() === NATIVE_TOKEN.toLowerCase() || amount === 0n) {
      return undefined;
    }
    this.requireWallet();
    const owner = this.walletClient!.account!.address;
    const allowance = await this.publicClient.readContract({
      address: token,
      abi: erc20PaymentAbi,
      functionName: "allowance",
      args: [owner, spender],
    });
    if (allowance >= amount) return undefined;
    const hash = await this.writeContract({
      address: token,
      abi: erc20PaymentAbi,
      functionName: "approve",
      args: [spender, amount],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async listPaymentTokens(): Promise<Address[]> {
    const treasury = this.requireTreasury();
    return [
      ...(await this.publicClient.readContract({
        address: treasury,
        abi: protocolTreasuryAbi,
        functionName: "getAllowedTokens",
      })),
    ];
  }

  async stakeAndJoin(
    schemaKey: string,
    stakeWei?: bigint,
    token: Address = NATIVE_TOKEN as Address
  ) {
    this.requireWallet();
    const schemaId = schemaIdFromKey(schemaKey);
    const minStake =
      stakeWei ??
      (await this.publicClient.readContract({
        address: this.addresses.AttesterRegistry,
        abi: attesterRegistryAbi,
        functionName: "minStake",
        args: [token],
      }));
    const isNative = token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
    if (!isNative) {
      await this.ensureAllowance(
        token,
        this.addresses.AttesterRegistry,
        minStake
      );
    }
    const hash = await this.writeContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "stakeAndJoin",
      args: [schemaId, token, minStake],
      value: isNative ? minStake : 0n,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { schemaId, txHash: hash, stake: minStake, token };
  }

  /**
   * Link another schema without extra stake (requires min stake already met,
   * including when minStake is 0).
   */
  async addSchema(schemaKey: string) {
    this.requireWallet();
    const schemaId = schemaIdFromKey(schemaKey);
    const hash = await this.writeContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "addSchema",
      args: [schemaId],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { schemaId, txHash: hash };
  }

  /** Governance: authorize attester for a schema without stake. */
  async authorizeAttester(attester: Address, schemaKey: string) {
    this.requireWallet();
    const schemaId = schemaIdFromKey(schemaKey);
    const hash = await this.writeContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "authorizeAttester",
      args: [attester, schemaId],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { schemaId, txHash: hash, attester };
  }

  /** Governance: revoke attester authorization for a schema. */
  async revokeAttester(attester: Address, schemaKey: string) {
    this.requireWallet();
    const schemaId = schemaIdFromKey(schemaKey);
    const hash = await this.writeContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "revokeAttester",
      args: [attester, schemaId],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { schemaId, txHash: hash, attester };
  }

  async getMinStake(
    token: Address = NATIVE_TOKEN as Address
  ): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "minStake",
      args: [token],
    });
  }

  async getAttesterStake(
    attester: Address,
    token: Address = NATIVE_TOKEN as Address
  ): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "stakeOf",
      args: [attester, token],
    });
  }

  async getUnbondDelay(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "unbondDelay",
    });
  }

  async getUnbondReleaseAt(attester: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "unbondReleaseAt",
      args: [attester],
    });
  }

  async startUnbond() {
    this.requireWallet();
    const hash = await this.writeContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "startUnbond",
      args: [],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  async withdrawAttesterStake(
    token: Address = NATIVE_TOKEN as Address
  ) {
    this.requireWallet();
    const hash = await this.writeContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "withdraw",
      args: [token],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash, token };
  }

  /**
   * Ensure this wallet can anchor `schemaKey`: no-op if already authorized;
   * otherwise `addSchema` when min stake is met, else `stakeAndJoin`.
   */
  async ensureAttesterForSchema(
    schemaKey: string,
    stakeWei?: bigint,
    token: Address = NATIVE_TOKEN as Address
  ): Promise<{
    schemaKey: string;
    schemaId: Hex;
    skipped: boolean;
    via: "existing" | "addSchema" | "stakeAndJoin";
    txHash?: Hex;
    stake?: bigint;
  }> {
    this.requireWallet();
    const me = this.accountAddress!;
    const schemaId = schemaIdFromKey(schemaKey);
    if (await this.isAuthorized(me, schemaKey)) {
      return { schemaKey, schemaId, skipped: true, via: "existing" };
    }
    const minStake = stakeWei ?? (await this.getMinStake(token));
    const stake = await this.getAttesterStake(me, token);
    if (stake >= minStake) {
      const res = await this.addSchema(schemaKey);
      return {
        schemaKey,
        schemaId,
        skipped: false,
        via: "addSchema",
        txHash: res.txHash,
        stake,
      };
    }
    const joined = await this.stakeAndJoin(schemaKey, stakeWei, token);
    return {
      schemaKey,
      schemaId,
      skipped: false,
      via: "stakeAndJoin",
      txHash: joined.txHash,
      stake: joined.stake,
    };
  }

  async isAuthorized(attester: Address, schemaKey: string): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "isAuthorized",
      args: [attester, schemaIdFromKey(schemaKey)],
    });
  }

  async issueAndAnchor(
    subject: Address,
    claims: EcoTestClaims,
    schemaKey = "peranto:EcoTestResult:v1"
  ): Promise<IssuedCredential & { anchorTx: Hex }> {
    return this.issueAndAnchorClaims(
      subject,
      claims as unknown as Record<string, unknown>,
      schemaKey,
      "EcoTestResult"
    );
  }

  /** Emit + anchor any schema (Member, CommonsWork, Care, compliance, custom). */
  async issueAndAnchorClaims(
    subject: Address,
    claims: Record<string, unknown>,
    schemaKey: string,
    credentialType?: string,
    opts?: {
      paymentToken?: Address;
      /** Unix seconds; with claimsCommitment uses anchorV2 */
      validUntil?: number | bigint;
      claimsCommitment?: Hex;
    }
  ): Promise<IssuedCredential & { anchorTx: Hex }> {
    this.requireWallet();
    const controller = this.accountAddress!;
    let signingKey = this.privateKey!;
    let kid: string | undefined;
    let issuerDidAddress: Address | undefined;

    if (this.assertionPrivateKey) {
      signingKey = this.assertionPrivateKey;
      issuerDidAddress = controller;
      kid = `${formatDid(this.network, controller)}#key-assertion`;
    } else if (this.mnemonic) {
      try {
        const doc = await this.resolveDid(
          formatDid(this.network, controller)
        );
        const hasAssertVm = doc.assertionMethod.some((id) =>
          id.includes("#key-assertion")
        );
        if (hasAssertVm) {
          const keys = await derivePurposeKeys(this.mnemonic, this.network);
          signingKey = keys.assertion.privateKey;
          issuerDidAddress = controller;
          kid = `${formatDid(this.network, controller)}#key-assertion`;
        }
      } catch {
        /* fallback controller */
      }
    }

    const issued = await issueJwtCredential({
      issuerPrivateKey: signingKey,
      issuerDidAddress,
      kid,
      network: this.network,
      subjectAddress: subject,
      claims,
      schemaKey,
      credentialType,
      credentialStatus: {
        contractAddress: this.addresses.CredentialStatusRegistry,
        chainId: NETWORK_CHAIN_ID[this.network],
      },
    });

    const token = (opts?.paymentToken ?? NATIVE_TOKEN) as Address;
    const fee = await this.getAnchorFee(token);
    const isNative = token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
    if (!isNative && fee > 0n) {
      await this.ensureAllowance(
        token,
        this.addresses.CredentialStatusRegistry,
        fee
      );
    }

    const useV2 =
      opts?.validUntil != null &&
      opts.validUntil !== 0 &&
      Boolean(opts.claimsCommitment);

    const hash = useV2
      ? await this.writeContract({
          address: this.addresses.CredentialStatusRegistry,
          abi: credentialStatusAbi,
          functionName: "anchorV2",
          args: [
            issued.credHash,
            schemaIdFromKey(schemaKey),
            subject,
            BigInt(opts!.validUntil!),
            opts!.claimsCommitment!,
            token,
            fee,
          ],
          value: isNative ? fee : 0n,
          chain: chainFor(this.network),
          account: this.walletClient!.account!,
        })
      : await this.writeContract({
          address: this.addresses.CredentialStatusRegistry,
          abi: credentialStatusAbi,
          functionName: "anchor",
          args: [issued.credHash, schemaIdFromKey(schemaKey), subject, token, fee],
          value: isNative ? fee : 0n,
          chain: chainFor(this.network),
          account: this.walletClient!.account!,
        });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { ...issued, anchorTx: hash };
  }

  async verifyCredential(jwt: string): Promise<{
    jwtValid: boolean;
    onChainStatus: number;
    onChainValid: boolean;
    authorized: boolean;
    details: Awaited<ReturnType<typeof verifyEcoTestJwt>>;
    status: {
      st: number;
      attester: Address;
      schemaId: Hex;
      subject: Address;
      anchoredAt: bigint;
      validUntil: bigint;
      claimsCommitment: Hex;
      revokeReason: string;
    };
  }> {
    let details = await verifyEcoTestJwt(jwt);
    if (!details.valid && details.issuerDid) {
      try {
        const doc = await this.resolveDid(details.issuerDid);
        const allowed: Address[] = [];
        for (const vmId of doc.assertionMethod) {
          const vm = doc.verificationMethod.find((v) => v.id === vmId);
          const m = vm?.blockchainAccountId
            ? /eip155:\d+:(0x[a-fA-F0-9]{40})/.exec(vm.blockchainAccountId)
            : null;
          if (m?.[1]) allowed.push(getAddress(m[1] as Address));
        }
        if (allowed.length) {
          details = await verifyEcoTestJwt(jwt, undefined, allowed);
        }
      } catch {
        /* keep first failure */
      }
    }
    if (!details.valid) {
      return {
        jwtValid: false,
        onChainStatus: 0,
        onChainValid: false,
        authorized: false,
        details,
        status: {
          st: 0,
          attester: "0x0000000000000000000000000000000000000000",
          schemaId: ("0x" + "00".repeat(32)) as Hex,
          subject: "0x0000000000000000000000000000000000000000",
          anchoredAt: 0n,
          validUntil: 0n,
          claimsCommitment: ("0x" + "00".repeat(32)) as Hex,
          revokeReason: "",
        },
      };
    }

    const statusTuple = await this.publicClient.readContract({
      address: this.addresses.CredentialStatusRegistry,
      abi: credentialStatusAbi,
      functionName: "statusV2",
      args: [details.credHash],
    });

    const status = {
      st: Number(statusTuple[0]),
      attester: statusTuple[1],
      schemaId: statusTuple[2],
      subject: statusTuple[3],
      anchoredAt: statusTuple[4],
      validUntil: statusTuple[5],
      claimsCommitment: statusTuple[6],
      revokeReason: statusTuple[7],
    };

    let onChainValid = false;
    try {
      onChainValid = Boolean(
        await this.publicClient.readContract({
          address: this.addresses.CredentialStatusRegistry,
          abi: credentialStatusAbi,
          functionName: "isValid",
          args: [details.credHash],
        })
      );
    } catch {
      onChainValid = status.st === 1;
    }

    const schemaKey =
      ((details.vc.credentialSchema as { id?: string } | undefined)?.id) ??
      "peranto:EcoTestResult:v1";
    const { address: issuer } = parseDid(details.issuerDid);
    const authorized = await this.isAuthorized(issuer, schemaKey);

    return {
      jwtValid: true,
      onChainStatus: status.st,
      onChainValid,
      authorized,
      details,
      status,
    };
  }

  async isCredentialValid(credHash: Hex): Promise<boolean> {
    return Boolean(
      await this.publicClient.readContract({
        address: this.addresses.CredentialStatusRegistry,
        abi: credentialStatusAbi,
        functionName: "isValid",
        args: [credHash],
      })
    );
  }

  async getCredentialStatusV2(credHash: Hex) {
    const t = await this.publicClient.readContract({
      address: this.addresses.CredentialStatusRegistry,
      abi: credentialStatusAbi,
      functionName: "statusV2",
      args: [credHash],
    });
    return {
      st: Number(t[0]),
      attester: t[1],
      schemaId: t[2],
      subject: t[3],
      anchoredAt: t[4],
      validUntil: t[5],
      claimsCommitment: t[6],
      revokeReason: t[7],
    };
  }

  /**
   * Verify DIF Well-Known DID Configuration for a page origin
   * (docs/well-known-did-configuration.md). Resolves issuer DID for assertion keys.
   */
  async verifyDomainLinkage(
    pageOrigin: string,
    opts: Omit<VerifyDomainLinkageOptions, "resolveDid"> = {}
  ): Promise<DomainLinkageVerifyResult> {
    return verifyDomainLinkage(pageOrigin, {
      ...opts,
      resolveDid: (did) => this.resolveDid(did),
    });
  }

  /**
   * Issue DomainLinkageCredential + did-configuration.json for an origin.
   * Operator hosts the JSON at `/.well-known/did-configuration.json`.
   */
  async createDidConfigurationForOrigin(params: {
    origin: string;
    expirationDate?: string;
  }) {
    this.requireWallet();
    const controller = this.accountAddress!;
    let signingKey = this.privateKey!;
    let kid: string | undefined;
    let issuerDidAddress: Address | undefined;

    if (this.assertionPrivateKey) {
      signingKey = this.assertionPrivateKey;
      issuerDidAddress = controller;
      kid = `${formatDid(this.network, controller)}#key-assertion`;
    } else if (this.mnemonic) {
      try {
        const doc = await this.resolveDid(
          formatDid(this.network, controller)
        );
        const hasAssertVm = doc.assertionMethod.some((id) =>
          id.includes("#key-assertion")
        );
        if (hasAssertVm) {
          const keys = await derivePurposeKeys(this.mnemonic, this.network);
          signingKey = keys.assertion.privateKey;
          issuerDidAddress = controller;
          kid = `${formatDid(this.network, controller)}#key-assertion`;
        }
      } catch {
        /* controller key */
      }
    }

    return createDidConfigurationForOrigin({
      issuerPrivateKey: signingKey,
      network: this.network,
      origin: params.origin,
      issuerDidAddress,
      kid,
      expirationDate: params.expirationDate,
    });
  }

  async revoke(credHash: Hex, reason: string) {
    this.requireWallet();
    const hash = await this.writeContract({
      address: this.addresses.CredentialStatusRegistry,
      abi: credentialStatusAbi,
      functionName: "revoke",
      args: [credHash, reason],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async registerName(label: string, token: Address = NATIVE_TOKEN as Address) {
    this.requireWallet();
    if (!this.addresses.NameRegistry) {
      throw new Error("NameRegistry not in deployment");
    }
    const fee = await this.publicClient.readContract({
      address: this.addresses.NameRegistry,
      abi: nameRegistryAbi,
      functionName: "registrationFee",
      args: [token],
    });
    const isNative = token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
    if (!isNative && fee > 0n) {
      await this.ensureAllowance(token, this.addresses.NameRegistry, fee);
    }
    const hash = await this.writeContract({
      address: this.addresses.NameRegistry,
      abi: nameRegistryAbi,
      functionName: "register",
      args: [label, token, fee],
      value: isNative ? fee : 0n,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      label,
      owner: this.accountAddress!,
      did: formatDid(this.network, this.accountAddress!),
      txHash: hash,
      token,
    };
  }

  async resolveName(label: string): Promise<{
    label: string;
    address: Address;
    did: string | null;
  }> {
    if (!this.addresses.NameRegistry) {
      throw new Error("NameRegistry not in deployment");
    }
    const clean = label.trim().replace(/^@+/, "").toLowerCase();
    if (!clean) throw new Error("Nombre vacío");
    const address = await this.publicClient.readContract({
      address: this.addresses.NameRegistry,
      abi: nameRegistryAbi,
      functionName: "resolve",
      args: [clean],
    });
    const zero = "0x0000000000000000000000000000000000000000";
    return {
      label: clean,
      address,
      did: address.toLowerCase() === zero ? null : formatDid(this.network, address),
    };
  }

  /**
   * Resolve a human handle (`@alice` / `alice`), a DID, or a raw address
   * into `{ address, did, label? }`.
   */
  async resolveIdentityRef(ref: string): Promise<{
    input: string;
    kind: "name" | "did" | "address";
    label?: string;
    address: Address;
    did: string;
  }> {
    const raw = ref.trim();
    if (!raw) throw new Error("Referencia vacía");

    if (raw.startsWith("did:peranto:")) {
      const { address } = parseDid(raw);
      return { input: raw, kind: "did", address, did: formatDid(this.network, address) };
    }

    if (isAddress(raw)) {
      const address = getAddress(raw);
      return {
        input: raw,
        kind: "address",
        address,
        did: formatDid(this.network, address),
      };
    }

    const named = await this.resolveName(raw);
    if (!named.did) {
      throw new Error(
        `@${named.label} no está registrado en este NameRegistry (tras un redespliegue hay que volver a registrar handles)`
      );
    }
    return {
      input: raw,
      kind: "name",
      label: named.label,
      address: named.address,
      did: named.did,
    };
  }

  async createNode(
    name: string,
    opts?: { seedWei?: bigint; reserveFloor?: bigint }
  ) {
    this.requireWallet();
    const factory = this.requireFactory();
    const seed = opts?.seedWei ?? 0n;
    const floor = opts?.reserveFloor;

    const decodeNode = (
      logs: readonly { data: Hex; topics: readonly Hex[] }[]
    ): Address | undefined => {
      for (const log of logs) {
        try {
          const parsed = decodeEventLog({
            abi: disCOFactoryAbi,
            data: log.data,
            topics: log.topics as [Hex, ...Hex[]],
          });
          if (parsed.eventName === "NodeCreated") {
            return parsed.args.node as Address;
          }
        } catch {
          /* skip */
        }
      }
      return undefined;
    };

    let hash: Hex;
    let usedAtomicSeed = false;

    const tryAtomic = async () => {
      if (floor !== undefined) {
        return this.writeContract({
          address: factory,
          abi: disCOFactoryAbi,
          functionName: "createNodeWithConfig",
          args: [name, floor],
          value: seed,
          chain: chainFor(this.network),
          account: this.walletClient!.account!,
        });
      }
      return this.writeContract({
      address: factory,
      abi: disCOFactoryAbi,
      functionName: "createNode",
      args: [name],
        value: seed,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    };

    try {
      hash = await tryAtomic();
      usedAtomicSeed = seed > 0n;
    } catch (err) {
      // Factory antiguo (Paseo): createNode no payable / sin WithConfig → create + fund.
      if (seed === 0n && floor === undefined) throw err;
      hash = await this.writeContract({
        address: factory,
          abi: disCOFactoryAbi,
        functionName: "createNode",
        args: [name],
        chain: chainFor(this.network),
        account: this.walletClient!.account!,
      });
      usedAtomicSeed = false;
    }

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    const node = decodeNode(receipt.logs);
    if (!node) throw new Error("NodeCreated event not found");

    let fundTx: Hex | undefined;
    if (seed > 0n && !usedAtomicSeed) {
      fundTx = await this.sendTransaction({
        to: node,
        value: seed,
        chain: chainFor(this.network),
        account: this.walletClient!.account!,
      });
      await this.publicClient.waitForTransactionReceipt({ hash: fundTx });
    }

    if (floor !== undefined && !usedAtomicSeed) {
      // Creator is governance of the node — set floor post-create on legacy factory.
      const floorTx = await this.writeContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "setReserveFloor",
        args: [floor],
        chain: chainFor(this.network),
        account: this.walletClient!.account!,
      });
      await this.publicClient.waitForTransactionReceipt({ hash: floorTx });
    }

    return {
      node,
      name,
      txHash: hash,
      seedWei: seed,
      reserveFloor: floor,
      fundTx,
    };
  }

  async tip(
    node: Address,
    to: Address,
    valueWei: bigint,
    token: Address = NATIVE_TOKEN as Address
  ) {
    this.requireWallet();
    const from = this.walletClient!.account!.address;
    if (from.toLowerCase() === to.toLowerCase()) {
      throw new Error("No puedes tiparte a ti mismo (Care/Love requieren otro peer)");
    }
    const isNative = token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
    if (!isNative) {
      await this.ensureAllowance(token, node, valueWei);
    }
    const hash = await this.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "tip",
      args: [to, token, valueWei],
      value: isNative ? valueWei : 0n,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async contribute(
    node: Address,
    valueWei: bigint,
    token: Address = NATIVE_TOKEN as Address
  ) {
    this.requireWallet();
    const isNative = token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
    if (!isNative) {
      await this.ensureAllowance(token, node, valueWei);
    }
    const hash = await this.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "contribute",
      args: [token, valueWei],
      value: isNative ? valueWei : 0n,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async harvest(
    node: Address,
    periodId: bigint,
    token: Address = NATIVE_TOKEN as Address
  ) {
    this.requireWallet();
    const hash = await this.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "harvest",
      args: [periodId, token],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async distribute(
    periodId: bigint,
    token: Address = NATIVE_TOKEN as Address
  ) {
    this.requireWallet();
    const treasury = this.requireTreasury();
    const hash = await this.writeContract({
      address: treasury,
      abi: protocolTreasuryAbi,
      functionName: "distribute",
      args: [periodId, token],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async addMember(node: Address, account: Address) {
    this.requireWallet();
    const hash = await this.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "addMember",
      args: [account],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async removeMember(node: Address, account: Address) {
    this.requireWallet();
    const hash = await this.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "removeMember",
      args: [account],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async withdrawNode(
    node: Address,
    to: Address,
    amountWei: bigint,
    token: Address = NATIVE_TOKEN as Address
  ) {
    this.requireWallet();
    const hash = await this.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "withdraw",
      args: [to, token, amountWei],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Dissolve a DisCO node: clears members, sends residual balance, unregisters
   * from ProtocolTreasury. Does **not** revoke credential anchors — pass
   * `revokeCredHashes` to revoke those in the same helper call.
   */
  async dissolveNode(
    node: Address,
    residualTo?: Address,
    opts?: { revokeCredHashes?: Hex[]; revokeReason?: string }
  ) {
    this.requireWallet();
    const to = residualTo ?? this.accountAddress!;
    const hash = await this.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "dissolve",
      args: [to],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    const revoked: Hex[] = [];
    if (opts?.revokeCredHashes?.length) {
      const reason = opts.revokeReason ?? "node-dissolved";
      for (const credHash of opts.revokeCredHashes) {
        revoked.push(await this.revoke(credHash, reason));
      }
    }
    return { txHash: hash, residualTo: to, revoked };
  }

  async recordNodeAnchor(node: Address, credHash: Hex) {
    this.requireWallet();
    const hash = await this.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "recordAnchor",
      args: [credHash],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async scores(node: Address, account: Address) {
    const [love, care, livelihood, currentPeriod] = await Promise.all([
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "lovePoints",
        args: [account],
      }),
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "carePoints",
        args: [account],
      }),
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "livelihoodPoints",
        args: [account],
      }),
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "currentPeriod",
      }),
    ]);
    return { love, care, livelihood, currentPeriod };
  }

  /** Sum Love / Care / Livelihood across nodes where account is a member. */
  async aggregateMemberScores(account: Address): Promise<{
    love: bigint;
    care: bigint;
    livelihood: bigint;
    nodes: Array<{
      address: Address;
      name: string;
      love: bigint;
      care: bigint;
      livelihood: bigint;
    }>;
  }> {
    const membership = await this.listMembershipNodes(account);
    let love = 0n;
    let care = 0n;
    let livelihood = 0n;
    const nodes: Array<{
      address: Address;
      name: string;
      love: bigint;
      care: bigint;
      livelihood: bigint;
    }> = [];
    for (const n of membership) {
      const s = await this.scores(n.address, account);
      love += s.love;
      care += s.care;
      livelihood += s.livelihood;
      nodes.push({
        address: n.address,
        name: n.name,
        love: s.love,
        care: s.care,
        livelihood: s.livelihood,
      });
    }
    return { love, care, livelihood, nodes };
  }

  async listNodes(): Promise<Address[]> {
    const treasury = this.requireTreasury();
    const all = [
      ...(await this.publicClient.readContract({
        address: treasury,
        abi: protocolTreasuryAbi,
        functionName: "getNodes",
      })),
    ];
    const flags = await Promise.all(
      all.map((node) =>
        this.publicClient.readContract({
          address: treasury,
          abi: protocolTreasuryAbi,
          functionName: "isNode",
          args: [node],
        })
      )
    );
    return all.filter((_, i) => flags[i]);
  }

  async listNodesWithMeta(): Promise<Array<{ address: Address; name: string; memberCount: bigint }>> {
    const nodes = await this.listNodes();
    return Promise.all(
      nodes.map(async (address) => {
        const [name, memberCount] = await Promise.all([
          this.publicClient.readContract({
            address,
            abi: disCONodeAbi,
            functionName: "name",
          }),
          this.publicClient.readContract({
            address,
            abi: disCONodeAbi,
            functionName: "memberCount",
          }),
        ]);
        return { address, name, memberCount };
      })
    );
  }

  /** DisCO nodes where `account` is currently a member (for tips / Love). */
  async listMembershipNodes(
    account: Address
  ): Promise<Array<{ address: Address; name: string; memberCount: bigint }>> {
    const all = await this.listNodesWithMeta();
    const flags = await Promise.all(
      all.map((n) => this.isMember(n.address, account))
    );
    return all.filter((_, i) => flags[i]);
  }

  async getMembers(node: Address): Promise<Address[]> {
    return [
      ...(await this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "members",
      })),
    ];
  }

  async isMember(node: Address, account: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "isMember",
      args: [account],
    });
  }

  /**
   * MVP: scan CredentialAnchored logs. Filter by subject and/or attester.
   * Prefer local vault for JWT possession; this lists on-chain anchors only.
   * JWT is NOT required to revoke — only credHash + attester/governance key.
   */
  async queryCredentialAnchors(opts?: {
    subject?: Address;
    attester?: Address;
    fromBlock?: bigint;
    toBlock?: bigint | "latest";
  }): Promise<
    Array<{
      credHash: Hex;
      schemaId: Hex;
      attester: Address;
      subject: Address;
      blockNumber: bigint;
      transactionHash: Hex;
      status?: number;
      revokeReason?: string;
    }>
  > {
    const logs = await getContractEventsChunked(this.publicClient, {
      address: this.addresses.CredentialStatusRegistry,
      abi: credentialStatusAbi,
      eventName: "CredentialAnchored",
      ...(opts?.attester
        ? { args: { attester: opts.attester } }
        : {}),
    });

    const wantSubject = opts?.subject?.toLowerCase();
    const wantAttester = opts?.attester?.toLowerCase();
    const out: Array<{
      credHash: Hex;
      schemaId: Hex;
      attester: Address;
      subject: Address;
      blockNumber: bigint;
      transactionHash: Hex;
      status?: number;
      revokeReason?: string;
    }> = [];

    for (const log of logs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = (log as any).args as {
        credHash?: Hex;
        schemaId?: Hex;
        attester?: Address;
        subject?: Address;
      };
      const subject = args.subject as Address;
      const attester = args.attester as Address;
      if (wantSubject && subject?.toLowerCase() !== wantSubject) continue;
      if (wantAttester && attester?.toLowerCase() !== wantAttester) continue;
      out.push({
        credHash: args.credHash as Hex,
        schemaId: args.schemaId as Hex,
        attester,
        subject,
        blockNumber: log.blockNumber ?? 0n,
        transactionHash: log.transactionHash as Hex,
      });
    }

    // Enrich with live status (Active / Revoked) — no JWT needed
    await Promise.all(
      out.map(async (row) => {
        try {
          const st = await this.getCredentialStatus(row.credHash);
          row.status = st.st;
          row.revokeReason = st.revokeReason;
        } catch {
          /* ignore */
        }
      })
    );

    return out;
  }

  /**
   * Aggregate on-chain activity for an address (names, VCs, DisCO events).
   * Uses chunked lookback — same limits as other log reads on Paseo.
   * Pass `fromBlock` for incremental sync after the first full lookback.
   */
  async queryUserActivity(
    account: Address,
    opts?: { fromBlock?: bigint; lookback?: bigint; toBlock?: bigint }
  ): Promise<ActivityTx[]> {
    const me = account.toLowerCase();
    const range = {
      fromBlock: opts?.fromBlock,
      lookback: opts?.lookback,
      toBlock: opts?.toBlock,
    };
    const rows: ActivityTx[] = [];
    const push = (
      type: ActivityTxType,
      log: { blockNumber?: bigint | null; transactionHash?: Hex | null; logIndex?: number | null },
      extra: Partial<ActivityTx> = {}
    ) => {
      const txHash = (log.transactionHash ?? "0x") as Hex;
      const blockNumber = log.blockNumber ?? 0n;
      const logIndex = log.logIndex ?? 0;
      rows.push({
        id: `${txHash}-${logIndex}-${type}`,
        type,
        label: ACTIVITY_TX_LABELS[type],
        txHash,
        blockNumber,
        logIndex,
        ...extra,
      });
    };

    const tasks: Promise<void>[] = [];

    if (this.addresses.NameRegistry) {
      const nameReg = this.addresses.NameRegistry;
      tasks.push(
        (async () => {
          const logs = await getContractEventsChunked(this.publicClient, {
            address: nameReg,
            abi: nameRegistryAbi,
            eventName: "NameRegistered",
            args: { owner: account },
            ...range,
          });
          for (const log of logs) {
            const args = (log as { args?: { label?: string } }).args;
            push("name.register", log, {
              detail: args?.label ? `@${args.label}` : undefined,
              role: "owner",
            });
          }
        })()
      );
      tasks.push(
        (async () => {
          const logs = await getContractEventsChunked(this.publicClient, {
            address: nameReg,
            abi: nameRegistryAbi,
            eventName: "NameReleased",
            args: { previousOwner: account },
            ...range,
          });
          for (const log of logs) {
            push("name.release", log, { role: "owner" });
          }
        })()
      );
    }

    tasks.push(
      (async () => {
        const logs = await getContractEventsChunked(this.publicClient, {
          address: this.addresses.DIDRegistry,
          abi: didRegistryAbi,
          eventName: "DIDAttributeChanged",
          args: { identity: account },
          ...range,
        });
        for (const log of logs) {
          const args = (log as {
            args?: { name?: Hex; value?: Hex };
          }).args;
          if (!args?.name) continue;
          const nameStr = attributeNameFromBytes32(args.name);
          if (!isServiceAttributeName(nameStr)) continue;
          const key = serviceAttrKeyFromAttributeName(nameStr);
          const cleared = !args.value || args.value === "0x";
          push(cleared ? "did.service.clear" : "did.service", log, {
            detail: key,
            role: "owner",
          });
        }
      })()
    );

    tasks.push(
      (async () => {
        const logs = await getContractEventsChunked(this.publicClient, {
          address: this.addresses.CredentialStatusRegistry,
          abi: credentialStatusAbi,
          eventName: "CredentialAnchored",
          ...range,
        });
        for (const log of logs) {
          const args = (log as {
            args?: { credHash?: Hex; attester?: Address; subject?: Address };
          }).args;
          const subject = args?.subject?.toLowerCase();
          const attester = args?.attester?.toLowerCase();
          if (subject !== me && attester !== me) continue;
          push("vc.anchor", log, {
            detail: args?.credHash ? `${args.credHash.slice(0, 12)}…` : undefined,
            counterpart: subject === me ? args?.attester : args?.subject,
            role: subject === me ? "subject" : "attester",
          });
        }
      })()
    );

    tasks.push(
      (async () => {
        const logs = await getContractEventsChunked(this.publicClient, {
          address: this.addresses.CredentialStatusRegistry,
          abi: credentialStatusAbi,
          eventName: "CredentialRevoked",
          args: { attester: account },
          ...range,
        });
        for (const log of logs) {
          const args = (log as {
            args?: { credHash?: Hex; reason?: string };
          }).args;
          push("vc.revoke", log, {
            detail: args?.reason || (args?.credHash ? `${args.credHash.slice(0, 12)}…` : undefined),
            role: "attester",
          });
        }
      })()
    );

    if (this.addresses.DisCOFactory) {
      const factory = this.addresses.DisCOFactory;
      tasks.push(
        (async () => {
          const logs = await getContractEventsChunked(this.publicClient, {
            address: factory,
            abi: disCOFactoryAbi,
            eventName: "NodeCreated",
            args: { creator: account },
            ...range,
          });
          for (const log of logs) {
            const args = (log as {
              args?: { node?: Address; name?: string };
            }).args;
            push("disco.create", log, {
              detail: args?.name,
              node: args?.node,
              role: "creator",
            });
          }
        })()
      );
    }

    const nodes = await this.listNodes().catch(() => [] as Address[]);
    for (const node of nodes) {
      const nodeName = await this.publicClient
        .readContract({
          address: node,
          abi: disCONodeAbi,
          functionName: "name",
        })
        .catch(() => "nodo");

      tasks.push(
        (async () => {
          const [fromTips, toTips, members, contribs, dissolved] =
            await Promise.all([
              getContractEventsChunked(this.publicClient, {
                address: node,
                abi: disCONodeAbi,
                eventName: "Tipped",
                args: { from: account },
                ...range,
              }),
              getContractEventsChunked(this.publicClient, {
                address: node,
                abi: disCONodeAbi,
                eventName: "Tipped",
                args: { to: account },
                ...range,
              }),
              getContractEventsChunked(this.publicClient, {
                address: node,
                abi: disCONodeAbi,
                eventName: "MemberUpdated",
                args: { account },
                ...range,
              }),
              getContractEventsChunked(this.publicClient, {
                address: node,
                abi: disCONodeAbi,
                eventName: "ActivityFee",
                args: { from: account },
                ...range,
              }),
              getContractEventsChunked(this.publicClient, {
                address: node,
                abi: disCONodeAbi,
                eventName: "Dissolved",
                ...range,
              }),
            ]);

          for (const log of fromTips) {
            const args = (log as {
              args?: { to?: Address; amount?: bigint };
            }).args;
            push("disco.tip", log, {
              detail: nodeName as string,
              node,
              counterpart: args?.to,
              valueWei: args?.amount,
              role: "from",
            });
          }
          for (const log of toTips) {
            const args = (log as {
              args?: { from?: Address; amount?: bigint };
            }).args;
            // avoid duplicates when tipping self
            if (args?.from?.toLowerCase() === me) continue;
            push("disco.tip", log, {
              detail: nodeName as string,
              node,
              counterpart: args?.from,
              valueWei: args?.amount,
              role: "to",
            });
          }
          for (const log of members) {
            const args = (log as { args?: { joined?: boolean } }).args;
            push(
              args?.joined ? "disco.member.join" : "disco.member.leave",
              log,
              { detail: nodeName as string, node }
            );
          }
          for (const log of contribs) {
            const args = (log as {
              args?: { toNode?: bigint; toProtocol?: bigint };
            }).args;
            const valueWei =
              (args?.toNode ?? 0n) + (args?.toProtocol ?? 0n);
            push("disco.contribute", log, {
              detail: nodeName as string,
              node,
              valueWei,
              role: "from",
            });
          }
          for (const log of dissolved) {
            const args = (log as {
              args?: { residualTo?: Address; amount?: bigint };
            }).args;
            if (args?.residualTo?.toLowerCase() !== me) continue;
            push("disco.dissolve", log, {
              detail: nodeName as string,
              node,
              valueWei: args?.amount,
              role: "governance",
            });
          }
        })()
      );
    }

    await Promise.all(tasks);

    // Plain PAS transfers (empty calldata) — recent window only
    try {
      const nativeLookback = opts?.lookback && opts.lookback < 2_500n
        ? opts.lookback
        : 2_500n;
      const transfers = await scanNativeTransfers(this.publicClient, account, {
        fromBlock: opts?.fromBlock,
        toBlock: opts?.toBlock,
        lookback: nativeLookback,
      });
      for (const t of transfers) {
        const type = t.direction === "send" ? "wallet.send" : "wallet.receive";
        rows.push({
          id: `${t.txHash}-${t.transactionIndex}-${type}`,
          type,
          label: ACTIVITY_TX_LABELS[type],
          txHash: t.txHash,
          blockNumber: t.blockNumber,
          logIndex: t.transactionIndex,
          counterpart: t.counterpart,
          valueWei: t.valueWei,
          detail:
            t.direction === "send"
              ? `Egreso → ${t.counterpart.slice(0, 10)}…`
              : `Ingreso ← ${t.counterpart.slice(0, 10)}…`,
          role: t.direction === "send" ? "from" : "to",
        });
      }
    } catch {
      /* native scan optional — RPC may throttle */
    }

    rows.sort((a, b) => {
      if (a.blockNumber === b.blockNumber) return b.logIndex - a.logIndex;
      return a.blockNumber > b.blockNumber ? -1 : 1;
    });
    return rows;
  }

  async getCredentialStatus(credHash: Hex) {
    const statusTuple = await this.publicClient.readContract({
      address: this.addresses.CredentialStatusRegistry,
      abi: credentialStatusAbi,
      functionName: "status",
      args: [credHash],
    });
    return {
      st: Number(statusTuple[0]),
      attester: statusTuple[1],
      schemaId: statusTuple[2],
      subject: statusTuple[3],
      anchoredAt: statusTuple[4],
      revokeReason: statusTuple[5],
    };
  }

  async getAnchorFee(
    token: Address = NATIVE_TOKEN as Address
  ): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.CredentialStatusRegistry,
      abi: credentialStatusAbi,
      functionName: "anchorFee",
      args: [token],
    });
  }

  async schemaExists(schemaKey: string): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addresses.SchemaRegistry,
      abi: schemaRegistryAbi,
      functionName: "schemaExists",
      args: [schemaIdFromKey(schemaKey)],
    });
  }

  async getSchema(schemaKey: string): Promise<{
    schemaId: Hex;
    schemaHash: Hex;
    uri: string;
    publisher: Address;
    registeredAt: bigint;
    exists: boolean;
  }> {
    const schemaId = schemaIdFromKey(schemaKey);
    const row = await this.publicClient.readContract({
      address: this.addresses.SchemaRegistry,
      abi: schemaRegistryAbi,
      functionName: "getSchema",
      args: [schemaId],
    });
    return {
      schemaId,
      schemaHash: row[0],
      uri: row[1],
      publisher: row[2],
      registeredAt: row[3],
      exists: row[4],
    };
  }

  async isSchemaPublisher(publisher: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addresses.SchemaRegistry,
      abi: schemaRegistryAbi,
      functionName: "publishers",
      args: [publisher],
    });
  }

  /** Governance: allow/deny an address to register schemas. */
  async setSchemaPublisher(publisher: Address, allowed: boolean) {
    this.requireWallet();
    const hash = await this.writeContract({
      address: this.addresses.SchemaRegistry,
      abi: schemaRegistryAbi,
      functionName: "setPublisher",
      args: [publisher, allowed],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash, publisher, allowed };
  }

  /**
   * Primary human name for an address (NameRegistry).
   * Prefer `hintLabels` (ej. cache local) — Paseo RPC no permite getLogs desde genesis.
   */
  async getPrimaryName(
    owner: Address,
    hintLabels: string[] = []
  ): Promise<string | null> {
    if (!this.addresses.NameRegistry) return null;
    const zero =
      "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
    const primaryHash = await this.publicClient.readContract({
      address: this.addresses.NameRegistry,
      abi: nameRegistryAbi,
      functionName: "primaryLabelOf",
      args: [owner],
    });
    if (primaryHash === zero) return null;

    for (const label of hintLabels) {
      const t = label.trim().toLowerCase();
      if (!t) continue;
      if (labelHashOf(t).toLowerCase() === primaryHash.toLowerCase()) {
        const resolved = await this.resolveName(t);
        if (resolved.address.toLowerCase() === owner.toLowerCase()) return t;
      }
    }

    // Logs en ventana reciente (sin fromBlock 0)
    const logs = await getContractEventsChunked(this.publicClient, {
      address: this.addresses.NameRegistry,
      abi: nameRegistryAbi,
      eventName: "NameRegistered",
    });
    for (const log of logs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = (log as any).args as {
        labelHash?: Hex;
        label?: string;
        owner?: Address;
      };
      if (!args?.owner || args.owner.toLowerCase() !== owner.toLowerCase()) {
        continue;
      }
      if (
        args.labelHash &&
        args.labelHash.toLowerCase() === primaryHash.toLowerCase() &&
        args.label
      ) {
        return args.label;
      }
    }
    return null;
  }

  /** Who owns a label, if anyone. */
  async lookupName(label: string): Promise<{
    label: string;
    owner: Address | null;
    available: boolean;
    isMine: boolean;
  }> {
    const resolved = await this.resolveName(label);
    const zero = "0x0000000000000000000000000000000000000000";
    const owner =
      resolved.address.toLowerCase() === zero.toLowerCase()
        ? null
        : resolved.address;
    const me = this.accountAddress?.toLowerCase();
    return {
      label,
      owner,
      available: owner === null,
      isMine: Boolean(owner && me && owner.toLowerCase() === me),
    };
  }


  /**
   * If you already own `label` on-chain, treat it as your display name
   * (no new register tx).
   */
  async claimOwnedName(label: string): Promise<{ label: string; alreadyOwned: true }> {
    const info = await this.lookupName(label);
    const me = this.accountAddress;
    if (!me) throw new Error("Wallet required");
    if (!info.owner || info.owner.toLowerCase() !== me.toLowerCase()) {
      throw new Error(
        info.owner
          ? `Nombre tomado por ${info.owner}`
          : "Nombre libre — usa registerName"
      );
    }
    return { label: info.label, alreadyOwned: true };
  }

  async getProtocolTreasuryStatus() {
    const treasury = this.requireTreasury();
    const factory = this.addresses.DisCOFactory;
    const [
      balance,
      nodeCount,
      equalBps,
      weightBps,
      periodBlocks,
      blockNumber,
      depositLogs,
      distributeLogs,
    ] = await Promise.all([
      this.publicClient.getBalance({ address: treasury }),
      this.publicClient.readContract({
        address: treasury,
        abi: protocolTreasuryAbi,
        functionName: "nodeCount",
      }),
      this.publicClient.readContract({
        address: treasury,
        abi: protocolTreasuryAbi,
        functionName: "equalBps",
      }),
      this.publicClient.readContract({
        address: treasury,
        abi: protocolTreasuryAbi,
        functionName: "weightBps",
      }),
      factory
        ? this.publicClient.readContract({
            address: factory,
            abi: disCOFactoryAbi,
            functionName: "periodBlocks",
          })
        : Promise.resolve(0n),
      this.publicClient.getBlockNumber(),
      getContractEventsChunked(this.publicClient, {
        address: treasury,
        abi: protocolTreasuryAbi,
        eventName: "Deposited",
      }),
      getContractEventsChunked(this.publicClient, {
        address: treasury,
        abi: protocolTreasuryAbi,
        eventName: "Distributed",
      }),
    ]);

    const currentPeriod =
      periodBlocks > 0n ? blockNumber / periodBlocks : 0n;
    const distributedNow = await this.publicClient.readContract({
      address: treasury,
      abi: protocolTreasuryAbi,
      functionName: "distributed",
      args: [currentPeriod, NATIVE_TOKEN as Address],
    });

    let incomeWei = 0n;
    for (const log of depositLogs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      incomeWei += ((log as any).args?.amount as bigint) ?? 0n;
    }
    let egressWei = 0n;
    for (const log of distributeLogs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      egressWei += ((log as any).args?.total as bigint) ?? 0n;
    }

    return {
      address: treasury,
      balance,
      nodeCount,
      equalBps,
      weightBps,
      periodBlocks,
      currentPeriod,
      distributedThisPeriod: distributedNow,
      incomeWei,
      egressWei,
      depositCount: depositLogs.length,
      distributeCount: distributeLogs.length,
      blockNumber,
    };
  }

  async getNodeEconomy(node: Address) {
    const [
      name,
      balance,
      currentPeriod,
      periodBlocks,
      createdPeriod,
      reserveFloor,
      memberCount,
      tipLogs,
      feeLogs,
      harvestLogs,
    ] = await Promise.all([
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "name",
      }),
      this.publicClient.getBalance({ address: node }),
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "currentPeriod",
      }),
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "periodBlocks",
      }),
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "createdPeriod",
      }),
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "reserveFloor",
        args: [NATIVE_TOKEN as Address],
      }),
      this.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "memberCount",
      }),
      getContractEventsChunked(this.publicClient, {
        address: node,
        abi: disCONodeAbi,
        eventName: "Tipped",
      }),
      getContractEventsChunked(this.publicClient, {
        address: node,
        abi: disCONodeAbi,
        eventName: "ActivityFee",
      }),
      getContractEventsChunked(this.publicClient, {
        address: node,
        abi: disCONodeAbi,
        eventName: "Harvested",
      }),
    ]);

    const statsTuple = await this.publicClient.readContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "periodStats",
      args: [currentPeriod],
    });
    const sustainBps = await this.publicClient.readContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "sustainBpsFor",
      args: [currentPeriod],
    });

    let tipsInWei = 0n;
    for (const log of tipLogs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = (log as any).args as { to?: Address; amount?: bigint };
      if (args.to?.toLowerCase() === node.toLowerCase()) {
        tipsInWei += args.amount ?? 0n;
      }
    }

    let contributeToNode = 0n;
    let contributeToProtocol = 0n;
    for (const log of feeLogs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = (log as any).args as { toNode?: bigint; toProtocol?: bigint };
      contributeToNode += args.toNode ?? 0n;
      contributeToProtocol += args.toProtocol ?? 0n;
    }
    let harvestOut = 0n;
    for (const log of harvestLogs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      harvestOut += ((log as any).args?.amount as bigint) ?? 0n;
    }

    return {
      address: node,
      name,
      balance,
      currentPeriod,
      periodBlocks,
      createdPeriod,
      reserveFloor,
      memberCount,
      sustainBps,
      periodLove: statsTuple[0] as bigint,
      periodCare: statsTuple[1] as bigint,
      periodAnchors: statsTuple[2] as bigint,
      periodFederationLinks: statsTuple[3] as bigint,
      periodHarvested: statsTuple[4] as boolean,
      incomeWei: tipsInWei + contributeToNode,
      egressWei: harvestOut,
      tipsInWei,
      contributeToNodeWei: contributeToNode,
      contributeToProtocolWei: contributeToProtocol,
      harvestOutWei: harvestOut,
    };
  }

  async getHoldings(account: Address): Promise<{
    symbol: string;
    walletWei: bigint;
    managedWei: bigint;
    totalWei: bigint;
    nodes: Array<{
      address: Address;
      name: string;
      balanceWei: bigint;
      role: "governance" | "member";
    }>;
  }> {
    const walletWei = await this.publicClient.getBalance({ address: account });
    const nodes = await this.listNodes();
    const managed: Array<{
      address: Address;
      name: string;
      balanceWei: bigint;
      role: "governance" | "member";
    }> = [];

    for (const address of nodes) {
      const [governance, isMem, name, balanceWei] = await Promise.all([
        this.publicClient.readContract({
          address,
          abi: disCONodeAbi,
          functionName: "governance",
        }),
        this.publicClient.readContract({
          address,
          abi: disCONodeAbi,
          functionName: "isMember",
          args: [account],
        }),
        this.publicClient.readContract({
          address,
          abi: disCONodeAbi,
          functionName: "name",
        }),
        this.publicClient.getBalance({ address }),
      ]);
      const isGov = governance.toLowerCase() === account.toLowerCase();
      if (!isGov && !isMem) continue;
      managed.push({
        address,
        name,
        balanceWei,
        role: isGov ? "governance" : "member",
      });
    }

    // Tesoro de nodos que gobiernas (control real del spend)
    const managedWei = managed
      .filter((n) => n.role === "governance")
      .reduce((acc, n) => acc + n.balanceWei, 0n);

    return {
      symbol: "PAS",
      walletWei,
      managedWei,
      totalWei: walletWei + managedWei,
      nodes: managed,
    };
  }

  private requireFactory(): Address {
    if (!this.addresses.DisCOFactory) {
      throw new Error("DisCOFactory not in deployment");
    }
    return this.addresses.DisCOFactory;
  }

  private requireTreasury(): Address {
    if (!this.addresses.ProtocolTreasury) {
      throw new Error("ProtocolTreasury not in deployment");
    }
    return this.addresses.ProtocolTreasury;
  }

  private requireWallet() {
    if (!this.walletClient || !this.privateKey) {
      throw new Error("Wallet private key required for this operation");
    }
  }
}

export { formatDid, parseDid, schemaIdFromKey, parseEther, getContract };
