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
  nameRegistryAbi,
  protocolTreasuryAbi,
  schemaRegistryAbi,
} from "./abi";
import {
  NETWORK_CHAIN_ID,
  DID_SERVICE_DEFAULT_VALIDITY,
  attributeNameFromBytes32,
  attributeNameToBytes32,
  decodeDidServiceValue,
  encodeDidServiceValue,
  formatDid,
  isServiceAttributeName,
  parseDid,
  resolveDidMinimal,
  schemaIdFromKey,
  serviceAttributeName,
  serviceAttrKeyFromAttributeName,
  serviceSlotFromAttributeName,
  serviceTypeFromAttributeName,
  type DidDocument,
  type DidService,
  type PerantoNetwork,
} from "./did";
import {
  issueJwtCredential,
  verifyEcoTestJwt,
  type EcoTestClaims,
  type IssuedCredential,
} from "./vc";
import { getContractEventsChunked, labelHashOf, scanNativeTransfers } from "./logs";
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

  constructor(opts: {
    network: PerantoNetwork;
    addresses: ContractAddresses;
    rpcUrl?: string;
    privateKey?: Hex;
  }) {
    this.network = opts.network;
    this.addresses = opts.addresses;
    this.privateKey = opts.privateKey;
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

  get accountAddress(): Address | undefined {
    return this.walletClient?.account?.address;
  }

  async resolveDid(did: string): Promise<DidDocument> {
    const { address } = parseDid(did);
    const deactivated = await this.publicClient.readContract({
      address: this.addresses.DIDRegistry,
      abi: didRegistryAbi,
      functionName: "deactivated",
      args: [address],
    });
    const services = await this.collectDidServices(did, address);
    return resolveDidMinimal(did, Boolean(deactivated), services);
  }

  /**
   * Rebuild active DID services from `DIDAttributeChanged` events
   * (`did/svc/<Type>` keys). Uses a wide lookback — Paseo RPCs reject genesis queries.
   */
  async collectDidServices(did: string, identity: Address): Promise<DidService[]> {
    const logs = await getContractEventsChunked(this.publicClient, {
      address: this.addresses.DIDRegistry,
      abi: didRegistryAbi,
      eventName: "DIDAttributeChanged",
      args: { identity },
      // ~30d @ 6s/block — short windows make older linktr33 services “vanish”
      lookback: 500_000n,
      chunkSize: 4_000n,
    });
    const now = Math.floor(Date.now() / 1000);
    // Latest write per attribute name wins
    const latest = new Map<string, { value: Hex; validTo: number }>();
    for (const log of logs) {
      const args = (log as { args?: { name?: Hex; value?: Hex; validTo?: bigint } })
        .args;
      if (!args?.name || args.value === undefined || args.validTo === undefined) {
        continue;
      }
      const nameStr = attributeNameFromBytes32(args.name);
      if (!isServiceAttributeName(nameStr)) continue;
      latest.set(nameStr, {
        value: args.value,
        validTo: Number(args.validTo),
      });
    }
    const out: DidService[] = [];
    for (const [nameStr, entry] of latest) {
      if (entry.validTo <= now) continue;
      const type = serviceTypeFromAttributeName(nameStr);
      const attrKey = serviceAttrKeyFromAttributeName(nameStr);
      const svc = decodeDidServiceValue(entry.value, type, did);
      if (svc) {
        // Prefer JSON name; else use slot from attr key as display tag
        const slot = serviceSlotFromAttributeName(nameStr);
        out.push({
          ...svc,
          attrKey,
          name: svc.name?.trim() || slot || undefined,
        });
      }
    }
    return out;
  }

  async setDidAttribute(
    name: string | Hex,
    value: Hex,
    validitySeconds: bigint = DID_SERVICE_DEFAULT_VALIDITY
  ) {
    this.requireWallet();
    const identity = this.accountAddress!;
    const nameBytes =
      typeof name === "string" && !name.startsWith("0x")
        ? attributeNameToBytes32(name)
        : (name as Hex);
    const hash = await this.walletClient!.writeContract({
      address: this.addresses.DIDRegistry,
      abi: didRegistryAbi,
      functionName: "setAttribute",
      args: [identity, nameBytes, value, validitySeconds],
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
  }) {
    const did = formatDid(this.network, this.accountAddress!);
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
      opts.validitySeconds ?? DID_SERVICE_DEFAULT_VALIDITY
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

  async deactivateDid(identity?: Address) {
    this.requireWallet();
    const id = identity ?? this.accountAddress!;
    const hash = await this.walletClient!.writeContract({
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
    const hash = await this.walletClient!.writeContract({
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
    const hash = await this.walletClient!.writeContract({
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

  async stakeAndJoin(schemaKey: string, stakeWei?: bigint) {
    this.requireWallet();
    const schemaId = schemaIdFromKey(schemaKey);
    const minStake =
      stakeWei ??
      (await this.publicClient.readContract({
        address: this.addresses.AttesterRegistry,
        abi: attesterRegistryAbi,
        functionName: "minStake",
      }));
    const hash = await this.walletClient!.writeContract({
      address: this.addresses.AttesterRegistry,
      abi: attesterRegistryAbi,
      functionName: "stakeAndJoin",
      args: [schemaId],
      value: minStake,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { schemaId, txHash: hash, stake: minStake };
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

  /** Emit + anchor any schema (Member, CommonsWork, Care, custom). */
  async issueAndAnchorClaims(
    subject: Address,
    claims: Record<string, unknown>,
    schemaKey: string,
    credentialType?: string
  ): Promise<IssuedCredential & { anchorTx: Hex }> {
    this.requireWallet();
    const issued = await issueJwtCredential({
      issuerPrivateKey: this.privateKey!,
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

    const fee = await this.publicClient.readContract({
      address: this.addresses.CredentialStatusRegistry,
      abi: credentialStatusAbi,
      functionName: "anchorFee",
    });

    const hash = await this.walletClient!.writeContract({
      address: this.addresses.CredentialStatusRegistry,
      abi: credentialStatusAbi,
      functionName: "anchor",
      args: [issued.credHash, schemaIdFromKey(schemaKey), subject],
      value: fee,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { ...issued, anchorTx: hash };
  }

  async verifyCredential(jwt: string): Promise<{
    jwtValid: boolean;
    onChainStatus: number;
    authorized: boolean;
    details: Awaited<ReturnType<typeof verifyEcoTestJwt>>;
    status: {
      st: number;
      attester: Address;
      schemaId: Hex;
      subject: Address;
      anchoredAt: bigint;
      revokeReason: string;
    };
  }> {
    const details = await verifyEcoTestJwt(jwt);
    if (!details.valid) {
      return {
        jwtValid: false,
        onChainStatus: 0,
        authorized: false,
        details,
        status: {
          st: 0,
          attester: "0x0000000000000000000000000000000000000000",
          schemaId: ("0x" + "00".repeat(32)) as Hex,
          subject: "0x0000000000000000000000000000000000000000",
          anchoredAt: 0n,
          revokeReason: "",
        },
      };
    }

    const statusTuple = await this.publicClient.readContract({
      address: this.addresses.CredentialStatusRegistry,
      abi: credentialStatusAbi,
      functionName: "status",
      args: [details.credHash],
    });

    const status = {
      st: Number(statusTuple[0]),
      attester: statusTuple[1],
      schemaId: statusTuple[2],
      subject: statusTuple[3],
      anchoredAt: statusTuple[4],
      revokeReason: statusTuple[5],
    };

    const schemaKey =
      ((details.vc.credentialSchema as { id?: string } | undefined)?.id) ??
      "peranto:EcoTestResult:v1";
    const { address: issuer } = parseDid(details.issuerDid);
    const authorized = await this.isAuthorized(issuer, schemaKey);

    return {
      jwtValid: true,
      onChainStatus: status.st,
      authorized,
      details,
      status,
    };
  }

  async revoke(credHash: Hex, reason: string) {
    this.requireWallet();
    const hash = await this.walletClient!.writeContract({
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

  async registerName(label: string) {
    this.requireWallet();
    if (!this.addresses.NameRegistry) {
      throw new Error("NameRegistry not in deployment");
    }
    const fee = await this.publicClient.readContract({
      address: this.addresses.NameRegistry,
      abi: nameRegistryAbi,
      functionName: "registrationFee",
    });
    const hash = await this.walletClient!.writeContract({
      address: this.addresses.NameRegistry,
      abi: nameRegistryAbi,
      functionName: "register",
      args: [label],
      value: fee,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      label,
      owner: this.accountAddress!,
      did: formatDid(this.network, this.accountAddress!),
      txHash: hash,
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
        return this.walletClient!.writeContract({
          address: factory,
          abi: disCOFactoryAbi,
          functionName: "createNodeWithConfig",
          args: [name, floor],
          value: seed,
          chain: chainFor(this.network),
          account: this.walletClient!.account!,
        });
      }
      return this.walletClient!.writeContract({
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
      hash = await this.walletClient!.writeContract({
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
      fundTx = await this.walletClient!.sendTransaction({
        to: node,
        value: seed,
        chain: chainFor(this.network),
        account: this.walletClient!.account!,
      });
      await this.publicClient.waitForTransactionReceipt({ hash: fundTx });
    }

    if (floor !== undefined && !usedAtomicSeed) {
      // Creator is governance of the node — set floor post-create on legacy factory.
      const floorTx = await this.walletClient!.writeContract({
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

  async tip(node: Address, to: Address, valueWei: bigint) {
    this.requireWallet();
    const from = this.walletClient!.account!.address;
    if (from.toLowerCase() === to.toLowerCase()) {
      throw new Error("No puedes tiparte a ti mismo (Care/Love requieren otro peer)");
    }
    const hash = await this.walletClient!.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "tip",
      args: [to],
      value: valueWei,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async contribute(node: Address, valueWei: bigint) {
    this.requireWallet();
    const hash = await this.walletClient!.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "contribute",
      args: [],
      value: valueWei,
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async harvest(node: Address, periodId: bigint) {
    this.requireWallet();
    const hash = await this.walletClient!.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "harvest",
      args: [periodId],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async distribute(periodId: bigint) {
    this.requireWallet();
    const treasury = this.requireTreasury();
    const hash = await this.walletClient!.writeContract({
      address: treasury,
      abi: protocolTreasuryAbi,
      functionName: "distribute",
      args: [periodId],
      chain: chainFor(this.network),
      account: this.walletClient!.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async addMember(node: Address, account: Address) {
    this.requireWallet();
    const hash = await this.walletClient!.writeContract({
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
    const hash = await this.walletClient!.writeContract({
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

  async withdrawNode(node: Address, to: Address, amountWei: bigint) {
    this.requireWallet();
    const hash = await this.walletClient!.writeContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "withdraw",
      args: [to, amountWei],
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
    const hash = await this.walletClient!.writeContract({
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
    const hash = await this.walletClient!.writeContract({
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

  async schemaExists(schemaKey: string): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addresses.SchemaRegistry,
      abi: schemaRegistryAbi,
      functionName: "schemaExists",
      args: [schemaIdFromKey(schemaKey)],
    });
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
      args: [currentPeriod],
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
