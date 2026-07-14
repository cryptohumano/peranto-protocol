#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import {
  PerantoClient,
  createIdentity,
  formatDid,
  loadDeployment,
  resolveDidMinimal,
  type PerantoNetwork,
} from "@peranto/sdk";
import type { Hex } from "viem";

function usage(): never {
  console.log(`peranto — did:peranto CLI

Usage:
  peranto did create [--network hardhat|paseo]
  peranto did resolve <did>
  peranto schema register <schemaKey> <uri> --private-key <hex> [--rpc url]
  peranto attester join <schemaKey> --private-key <hex> [--stake wei]
  peranto vc issue --private-key <hex> --subject <address> --sample <id> --type <t> --result <r> --unit <u> --lab <name>
  peranto vc verify <jwt-file-or-string> --rpc optional
  peranto vc revoke <credHash> --private-key <hex> --reason <text>
  peranto name register <label> --private-key <hex>
  peranto name resolve <label>

Env:
  PERANTO_NETWORK=hardhat|paseo (default hardhat)
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
  if (n !== "hardhat" && n !== "localhost" && n !== "paseo") {
    throw new Error(`Unknown network ${n}`);
  }
  return n;
}

function chainIdOf(network: PerantoNetwork): number {
  return network === "paseo" ? 420420417 : 31337;
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
    (network === "paseo"
      ? "https://eth-rpc-testnet.polkadot.io/"
      : "http://127.0.0.1:8545")
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
      console.log(JSON.stringify(resolveDidMinimal(did!), null, 2));
    }
    return;
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
      labName: arg("--lab", argv) || "EcoLab Demo",
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

  usage();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
