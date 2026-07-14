import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import {
  attesterRegistryAbi,
  credentialStatusAbi,
  didRegistryAbi,
  nameRegistryAbi,
  schemaRegistryAbi,
} from "./abi";
import {
  NETWORK_CHAIN_ID,
  formatDid,
  parseDid,
  resolveDidMinimal,
  schemaIdFromKey,
  type DidDocument,
  type PerantoNetwork,
} from "./did";
import {
  issueEcoTestCredential,
  verifyEcoTestJwt,
  type EcoTestClaims,
  type IssuedCredential,
} from "./vc";

export type ContractAddresses = {
  DIDRegistry: Address;
  SchemaRegistry: Address;
  AttesterRegistry: Address;
  CredentialStatusRegistry: Address;
  NameRegistry?: Address;
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
  if (network === "paseo") return paseoChain;
  return hardhat;
}

export class PerantoClient {
  readonly network: PerantoNetwork;
  readonly addresses: ContractAddresses;
  readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
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
    return resolveDidMinimal(did, Boolean(deactivated));
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
    this.requireWallet();
    const issued = await issueEcoTestCredential({
      issuerPrivateKey: this.privateKey!,
      network: this.network,
      subjectAddress: subject,
      claims,
      schemaKey,
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
    const address = await this.publicClient.readContract({
      address: this.addresses.NameRegistry,
      abi: nameRegistryAbi,
      functionName: "resolve",
      args: [label],
    });
    const zero = "0x0000000000000000000000000000000000000000";
    return {
      label,
      address,
      did: address.toLowerCase() === zero ? null : formatDid(this.network, address),
    };
  }

  private requireWallet() {
    if (!this.walletClient || !this.privateKey) {
      throw new Error("Wallet private key required for this operation");
    }
  }
}

export function loadDeployment(chainId: number): ContractAddresses & {
  schemas?: Record<string, Hex>;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  const file = path.resolve(__dirname, "../../../deployments", `${chainId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Deployment file not found: ${file}. Run deploy first.`);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    contracts: ContractAddresses;
    schemas?: Record<string, Hex>;
  };
  return { ...raw.contracts, schemas: raw.schemas };
}

export { formatDid, parseDid, schemaIdFromKey, parseEther, getContract };
