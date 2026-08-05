#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import {
  PerantoClient,
  createIdentity,
  formatDid,
  loadDeployment,
  parseEther,
  resolveDidDocument,
  type PerantoNetwork,
} from "@peranto/sdk";
import type { Address, Hex } from "viem";

function usage(): never {
  console.log(`peranto — did:peranto CLI

Usage:
  peranto did create [--network hardhat|paseo|base|baseSepolia|arbitrum|arbitrumSepolia]
  peranto did resolve <did>
  peranto did delegate add <address> [--type svc|sigAuth|veriKey] [--days 365] --private-key <hex>
  peranto did delegate revoke <address> [--type svc|sigAuth|veriKey] --private-key <hex>
  peranto schema register <schemaKey> <uri> --private-key <hex> [--rpc url]
  peranto attester join <schemaKey> --private-key <hex> [--stake wei]
  peranto vc issue --private-key <hex> --subject <address> --sample <id> --type <t> --result <r> --unit <u> --lab <name>
  peranto vc verify <jwt-file-or-string> --rpc optional
  peranto vc revoke <credHash> --private-key <hex> --reason <text>
  peranto name register <label> --private-key <hex>
  peranto name resolve <label>
  peranto disco create <name> --private-key <hex>
  peranto disco tip <node> <to> --value <wei|ether> --private-key <hex>
  peranto disco contribute <node> --value <wei|ether> --private-key <hex>
  peranto disco harvest <node> <periodId> --private-key <hex>
  peranto disco distribute <periodId> --private-key <hex>
  peranto disco scores <node> <account>
  peranto disco member add <node> <account> --private-key <hex>
  peranto disco dissolve <node> [--to 0x…] --private-key <hex>

Env:
  PERANTO_NETWORK=hardhat|paseo|base|baseSepolia|arbitrum|arbitrumSepolia
  PERANTO_RPC_URL=
  PERANTO_KEY=0x...
`);
  process.exit(1);
}

function arg(flag: string, argv: string[]): string | undefined {
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return undefined;
}

function networkFrom(argv: string[]): PerantoNetwork {
  const n =
    arg("--network", argv) ||
    process.env.PERANTO_NETWORK ||
    "hardhat";
  const allowed: PerantoNetwork[] = [
    "hardhat",
    "localhost",
    "paseo",
    "base",
    "baseSepolia",
    "arbitrum",
    "arbitrumSepolia",
  ];
  if (!allowed.includes(n as PerantoNetwork)) {
    throw new Error(`Unknown network ${n}`);
  }
  return n as PerantoNetwork;
}

function chainIdOf(network: PerantoNetwork): number {
  const map: Record<PerantoNetwork, number> = {
    hardhat: 31337,
    localhost: 31337,
    paseo: 420420417,
    base: 8453,
    baseSepolia: 84532,
    arbitrum: 42161,
    arbitrumSepolia: 421614,
  };
  return map[network];
}

function keyFrom(argv: string[]): Hex {
  const k =
    arg("--private-key", argv) ||
    arg("-k", argv) ||
    process.env.PERANTO_KEY;
  if (!k) throw new Error("Missing --private-key / -k or PERANTO_KEY");
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

function rpcOf(network: PerantoNetwork, argv: string[]): string {
  return (
    arg("--rpc", argv) ||
    process.env.PERANTO_RPC_URL ||
    ({
      hardhat: "http://127.0.0.1:8545",
      localhost: "http://127.0.0.1:8545",
      paseo: "https://eth-rpc-testnet.polkadot.io/",
      base: "https://mainnet.base.org",
      baseSepolia: "https://sepolia.base.org",
      arbitrum: "https://arb1.arbitrum.io/rpc",
      arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc",
    } as Record<PerantoNetwork, string>)[network]
  );
}

function client(argv: string[], withKey = false): PerantoClient {
  const network = networkFrom(argv);
  const addresses = loadDeployment(chainIdOf(network));
  return new PerantoClient({
    network,
    addresses,
    rpcUrl: rpcOf(network, argv),
    privateKey: withKey ? keyFrom(argv) : undefined,
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage();

  const [cmd, sub, ...rest] = argv;

  if (cmd === "did" && sub === "create") {
    const network = networkFrom(argv);
    const id = createIdentity(network);
    const out = {
      did: id.did,
      address: id.address,
      privateKey: id.privateKey,
    };
    const dir = path.resolve(process.cwd(), ".peranto");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${network}-${id.address}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ ...out, saved: file }, null, 2));
    return;
  }

  if (cmd === "did" && sub === "resolve") {
    const did = rest[0] || arg("--did", argv);
    if (!did) usage();
    try {
      const c = client(argv);
      const doc = await c.resolveDid(did!);
      console.log(JSON.stringify(doc, null, 2));
    } catch {
      console.log(JSON.stringify(resolveDidDocument(did!), null, 2));
    }
    return;
  }

  if (cmd === "did" && sub === "delegate") {
    const action = rest[0];
    const delegate = rest[1] as Address;
    const dtype = arg("--type", argv) || "svc";
    if (!action || !delegate) usage();
    const c = client(argv, true);
    if (action === "add") {
      const days = BigInt(arg("--days", argv) || "365");
      const tx = await c.addDelegate({
        delegateType: dtype,
        delegate,
        validitySeconds: days * 24n * 60n * 60n,
      });
      console.log(JSON.stringify({ tx, action, delegateType: dtype, delegate }, null, 2));
      return;
    }
    if (action === "revoke") {
      const tx = await c.revokeDelegate({
        delegateType: dtype,
        delegate,
      });
      console.log(JSON.stringify({ tx, action, delegateType: dtype, delegate }, null, 2));
      return;
    }
    usage();
  }

  if (cmd === "schema" && sub === "register") {
    const schemaKey = rest[0];
    const uri = rest[1];
    if (!schemaKey || !uri) usage();
    const c = client(argv, true);
    const body = JSON.stringify({ $id: schemaKey, type: "object" });
    const res = await c.registerSchema(schemaKey!, uri!, body);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "attester" && sub === "join") {
    const schemaKey = rest[0] || "peranto:EcoTestResult:v1";
    const stake = arg("--stake", argv);
    const c = client(argv, true);
    const res = await c.stakeAndJoin(
      schemaKey,
      stake !== undefined ? BigInt(stake) : undefined
    );
    console.log(JSON.stringify({
      ...res,
      stake: res.stake.toString(),
      attester: c.accountAddress,
      did: formatDid(networkFrom(argv), c.accountAddress!),
    }, null, 2));
    return;
  }

  if (cmd === "vc" && sub === "issue") {
    const subject = arg("--subject", argv);
    if (!subject) usage();
    const c = client(argv, true);
    const issued = await c.issueAndAnchor(subject as `0x${string}`, {
      sampleId: arg("--sample", argv) || "S-001",
      testType: arg("--type", argv) || "pH",
      result: arg("--result", argv) || "7.2",
      unit: arg("--unit", argv) || "pH",
      labName: arg("--lab", argv) || "EcosystemLab Demo",
      testedAt: new Date().toISOString(),
    });
    const dir = path.resolve(process.cwd(), ".peranto");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `vc-${issued.credHash.slice(2, 10)}.jwt`);
    fs.writeFileSync(file, issued.jwt);
    console.log(
      JSON.stringify(
        {
          issuerDid: issued.issuerDid,
          subjectDid: issued.subjectDid,
          credHash: issued.credHash,
          anchorTx: issued.anchorTx,
          jwtFile: file,
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "vc" && sub === "verify") {
    const input = rest[0];
    if (!input) usage();
    const jwt = fs.existsSync(input)
      ? fs.readFileSync(input, "utf8").trim()
      : input;
    const c = client(argv);
    const result = await c.verifyCredential(jwt);
    console.log(
      JSON.stringify(
        {
          jwtValid: result.jwtValid,
          authorized: result.authorized,
          onChainStatus: ["None", "Active", "Revoked"][result.onChainStatus],
          issuerDid: result.details.issuerDid,
          subjectDid: result.details.subjectDid,
          credHash: result.details.credHash,
          error: result.details.error,
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "vc" && sub === "revoke") {
    const credHash = rest[0] as Hex;
    const reason = arg("--reason", argv) || "revoked";
    if (!credHash) usage();
    const c = client(argv, true);
    const tx = await c.revoke(credHash, reason);
    console.log(JSON.stringify({ tx, credHash, reason }, null, 2));
    return;
  }

  if (cmd === "name" && sub === "register") {
    const label = rest[0];
    if (!label) usage();
    const c = client(argv, true);
    const res = await c.registerName(label!);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "name" && sub === "resolve") {
    const label = rest[0];
    if (!label) usage();
    const c = client(argv);
    const res = await c.resolveName(label!);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "disco" && sub === "create") {
    const name = rest[0];
    if (!name) usage();
    const seedRaw = arg("--seed", argv) ?? "0";
    const floorRaw = arg("--floor", argv);
    const seedWei = seedRaw.includes(".")
      ? parseEther(seedRaw)
      : BigInt(seedRaw);
    const reserveFloor =
      floorRaw === undefined
        ? undefined
        : floorRaw.includes(".")
          ? parseEther(floorRaw)
          : BigInt(floorRaw);
    const c = client(argv, true);
    const res = await c.createNode(name!, { seedWei, reserveFloor });
    console.log(JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    return;
  }

  if (cmd === "disco" && sub === "tip") {
    const node = rest[0] as Address;
    const to = rest[1] as Address;
    const valueRaw = arg("--value", argv);
    if (!node || !to || !valueRaw) usage();
    const c = client(argv, true);
    const value = valueRaw!.includes(".")
      ? parseEther(valueRaw!)
      : BigInt(valueRaw!);
    const tx = await c.tip(node, to, value);
    console.log(JSON.stringify({ tx, node, to, value: value.toString() }, null, 2));
    return;
  }

  if (cmd === "disco" && sub === "contribute") {
    const node = rest[0] as Address;
    const valueRaw = arg("--value", argv);
    if (!node || !valueRaw) usage();
    const c = client(argv, true);
    const value = valueRaw!.includes(".")
      ? parseEther(valueRaw!)
      : BigInt(valueRaw!);
    const tx = await c.contribute(node, value);
    console.log(JSON.stringify({ tx, node, value: value.toString() }, null, 2));
    return;
  }

  if (cmd === "disco" && sub === "harvest") {
    const node = rest[0] as Address;
    const periodId = rest[1];
    if (!node || periodId === undefined) usage();
    const c = client(argv, true);
    const tx = await c.harvest(node, BigInt(periodId!));
    console.log(JSON.stringify({ tx, node, periodId }, null, 2));
    return;
  }

  if (cmd === "disco" && sub === "distribute") {
    const periodId = rest[0];
    if (periodId === undefined) usage();
    const c = client(argv, true);
    const tx = await c.distribute(BigInt(periodId!));
    console.log(JSON.stringify({ tx, periodId }, null, 2));
    return;
  }

  if (cmd === "disco" && sub === "scores") {
    const node = rest[0] as Address;
    const account = rest[1] as Address;
    if (!node || !account) usage();
    const c = client(argv);
    const res = await c.scores(node, account);
    console.log(
      JSON.stringify(
        {
          node,
          account,
          love: res.love.toString(),
          care: res.care.toString(),
          currentPeriod: res.currentPeriod.toString(),
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "disco" && sub === "dissolve") {
    const node = rest[0] as Address;
    if (!node) usage();
    const to = arg("--to", argv) as Address | undefined;
    const c = client(argv, true);
    const res = await c.dissolveNode(node, to);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "disco" && sub === "member") {
    const action = rest[0];
    const node = rest[1] as Address;
    const account = rest[2] as Address;
    if (action !== "add" || !node || !account) usage();
    const c = client(argv, true);
    const tx = await c.addMember(node, account);
    console.log(JSON.stringify({ tx, node, account }, null, 2));
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
